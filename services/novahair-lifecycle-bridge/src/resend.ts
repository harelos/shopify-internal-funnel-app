import { canDispatchTo, lifecycleConfig } from "./config";
import { hashEmail, hashPayload } from "./crypto";
import { incrementUsageOnce, isoNow, recordLifecycleError, setHealth, usageSnapshot } from "./db";
import { captureResendQuotaHeaders } from "./quota";
import type { LifecycleEnv, OutboundLifecycleEvent } from "./types";

export interface ResendDispatchResult {
  sent: boolean;
  duplicate: boolean;
  status: "SENT" | "RETRY" | "UNCERTAIN" | "DEAD";
}

interface ExistingEventRow {
  status: "PENDING" | "SENDING" | "SENT" | "RETRY" | "UNCERTAIN" | "DEAD" | "CANCELLED";
  attempts: number;
  max_attempts: number;
}

interface ContactUpdateRow {
  idempotency_key: string;
  email: string;
  email_hash: string;
  unsubscribed: number;
  status: "PENDING" | "SENDING" | "SENT" | "RETRY" | "DEAD";
  attempts: number;
  max_attempts: number;
}

function safeCode(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  return /^[a-z0-9_:-]{1,100}$/i.test(value) ? value : "resend_dispatch_error";
}

export function classifyResendResponse(status: number): "success" | "retry" | "dead" {
  if (status >= 200 && status < 300) return "success";
  if ([408, 409, 425, 429].includes(status) || status >= 500) return "retry";
  return "dead";
}

export async function queueResendUnsubscribe(
  env: LifecycleEnv,
  input: { email: string; emailHash: string; idempotencyKey: string; now: string },
): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO resend_contact_updates (
       idempotency_key, email, email_hash, unsubscribed, status, attempts, max_attempts,
       next_attempt_at, created_at, updated_at
     ) VALUES (?, ?, ?, 1, 'PENDING', 0, 7, ?, ?, ?)`,
  ).bind(input.idempotencyKey, input.email, input.emailHash, input.now, input.now, input.now).run();
}

async function updateResendContact(
  apiKey: string,
  row: ContactUpdateRow,
  fetcher: typeof fetch,
): Promise<Response> {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "User-Agent": "novahair-lifecycle-worker/1.0",
  };
  const patch = await fetcher(`https://api.resend.com/contacts/${encodeURIComponent(row.email)}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ unsubscribed: row.unsubscribed === 1 }),
    signal: AbortSignal.timeout(15_000),
  });
  if (patch.status !== 404) return patch;
  return fetcher("https://api.resend.com/contacts", {
    method: "POST",
    headers,
    body: JSON.stringify({ email: row.email, unsubscribed: row.unsubscribed === 1 }),
    signal: AbortSignal.timeout(15_000),
  });
}

export async function dispatchResendContactUpdates(
  env: LifecycleEnv,
  now = new Date(),
  fetcher: typeof fetch = fetch,
): Promise<{ attempted: number; sent: number; failed: number }> {
  const config = lifecycleConfig(env);
  const current = isoNow(now);
  const rows = await env.DB.prepare(
    `SELECT idempotency_key, email, email_hash, unsubscribed, status, attempts, max_attempts
     FROM resend_contact_updates
     WHERE status IN ('PENDING', 'RETRY') AND next_attempt_at <= ?
     ORDER BY next_attempt_at ASC LIMIT 25`,
  ).bind(current).all<ContactUpdateRow>();
  if (!(rows.results?.length ?? 0)) return { attempted: 0, sent: 0, failed: 0 };
  if (!config.resendApiKey) throw new Error("resend_api_key_missing");
  let sent = 0;
  let failed = 0;
  for (const row of rows.results ?? []) {
    if (!canDispatchTo(env, row.email)) {
      await env.DB.prepare(
        `UPDATE resend_contact_updates
         SET status = 'DEAD', last_error_code = 'recipient_not_allowed_in_current_mode', updated_at = ?
         WHERE idempotency_key = ?`,
      ).bind(current, row.idempotency_key).run();
      failed += 1;
      continue;
    }
    await env.DB.prepare(
      `UPDATE resend_contact_updates SET status = 'SENDING', attempts = attempts + 1, updated_at = ?
       WHERE idempotency_key = ? AND status IN ('PENDING', 'RETRY')`,
    ).bind(current, row.idempotency_key).run();
    try {
      const response = await updateResendContact(config.resendApiKey, row, fetcher);
      const classification = classifyResendResponse(response.status);
      if (classification === "success") {
        await env.DB.prepare(
          `UPDATE resend_contact_updates
           SET status = 'SENT', sent_at = ?, updated_at = ?, last_http_status = ?, last_error_code = NULL
           WHERE idempotency_key = ?`,
        ).bind(current, current, response.status, row.idempotency_key).run();
        sent += 1;
        continue;
      }
      const exhausted = row.attempts + 1 >= row.max_attempts;
      const retryable = classification === "retry" || [409, 422].includes(response.status);
      await env.DB.prepare(
        `UPDATE resend_contact_updates
         SET status = ?, next_attempt_at = ?, updated_at = ?, last_http_status = ?, last_error_code = ?
         WHERE idempotency_key = ?`,
      ).bind(
        retryable && !exhausted ? "RETRY" : "DEAD",
        new Date(now.getTime() + Math.min(6 * 60 * 60_000, 30_000 * 2 ** row.attempts)).toISOString(),
        current,
        response.status,
        `resend_contact_http_${response.status}`,
        row.idempotency_key,
      ).run();
      failed += 1;
    } catch {
      const exhausted = row.attempts + 1 >= row.max_attempts;
      await env.DB.prepare(
        `UPDATE resend_contact_updates
         SET status = ?, next_attempt_at = ?, updated_at = ?, last_http_status = NULL,
             last_error_code = 'resend_contact_network_error'
         WHERE idempotency_key = ?`,
      ).bind(
        exhausted ? "DEAD" : "RETRY",
        new Date(now.getTime() + Math.min(6 * 60 * 60_000, 30_000 * 2 ** row.attempts)).toISOString(),
        current,
        row.idempotency_key,
      ).run();
      failed += 1;
    }
  }
  await setHealth(
    env.DB,
    "resend_contact_sync_status",
    JSON.stringify({ attempted: rows.results?.length ?? 0, sent, failed }),
    failed ? "DEGRADED" : "OK",
    current,
  );
  return { attempted: rows.results?.length ?? 0, sent, failed };
}

export async function sendLifecycleEvent(
  env: LifecycleEnv,
  input: {
    idempotencyKey: string;
    entityType: string;
    entityId: string;
    event: OutboundLifecycleEvent;
    now?: Date;
    fetcher?: typeof fetch;
  },
): Promise<ResendDispatchResult> {
  const now = input.now ?? new Date();
  const current = isoNow(now);
  const config = lifecycleConfig(env);
  if (!canDispatchTo(env, input.event.email)) throw new Error("recipient_not_allowed_in_current_mode");
  if (!config.resendApiKey) throw new Error("resend_api_key_missing");

  const quota = await usageSnapshot(env.DB, now);
  if (!quota.dispatchAllowed) {
    await setHealth(env.DB, "resend_quota_status", JSON.stringify(quota), "CRITICAL", current);
    throw new Error("resend_free_tier_guard_active");
  }

  const contactHash = await hashEmail(input.event.email, config.hashKey);
  const payloadHash = await hashPayload(input.event.payload);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO resend_events (
       idempotency_key, event_name, entity_type, entity_id, contact_hash,
       payload_hash, status, attempts, max_attempts, next_attempt_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 0, 7, ?, ?)`,
  ).bind(
    input.idempotencyKey,
    input.event.event,
    input.entityType,
    input.entityId,
    contactHash,
    payloadHash,
    current,
    current,
  ).run();

  const existing = await env.DB.prepare(
    "SELECT status, attempts, max_attempts FROM resend_events WHERE idempotency_key = ?",
  ).bind(input.idempotencyKey).first<ExistingEventRow>();
  if (!existing) throw new Error("resend_outbox_reservation_failed");
  if (existing.status === "SENT") return { sent: true, duplicate: true, status: "SENT" };
  if (existing.status === "DEAD" || existing.status === "CANCELLED") {
    return { sent: false, duplicate: true, status: "DEAD" };
  }
  if (existing.status === "UNCERTAIN") {
    return { sent: false, duplicate: true, status: "UNCERTAIN" };
  }
  if (existing.attempts >= existing.max_attempts) {
    await env.DB.prepare(
      "UPDATE resend_events SET status = 'DEAD', last_error_code = 'max_attempts_exhausted' WHERE idempotency_key = ?",
    ).bind(input.idempotencyKey).run();
    return { sent: false, duplicate: false, status: "DEAD" };
  }

  await env.DB.prepare(
    `UPDATE resend_events
     SET status = 'SENDING', attempts = attempts + 1, last_error_code = NULL
     WHERE idempotency_key = ? AND status IN ('PENDING', 'RETRY', 'SENDING')`,
  ).bind(input.idempotencyKey).run();

  const fetcher = input.fetcher ?? fetch;
  let response: Response;
  try {
    response = await fetcher("https://api.resend.com/events/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.resendApiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "novahair-lifecycle-worker/1.0",
        "Idempotency-Key": input.idempotencyKey.slice(0, 256),
      },
      body: JSON.stringify({
        event: input.event.event,
        email: input.event.email,
        payload: input.event.payload,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    await env.DB.prepare(
      `UPDATE resend_events
       SET status = 'UNCERTAIN', last_error_code = 'network_outcome_uncertain',
           next_attempt_at = ?, last_http_status = NULL
       WHERE idempotency_key = ?`,
    ).bind(new Date(now.getTime() + 5 * 60_000).toISOString(), input.idempotencyKey).run();
    await Promise.all([
      setHealth(env.DB, "last_resend_event", "network_outcome_uncertain", "CRITICAL", current),
      recordLifecycleError(env.DB, {
        component: "resend_event",
        code: "network_outcome_uncertain",
        safeMessage: "Resend event delivery outcome is uncertain; automatic duplicate-prone retry was stopped.",
        contextHash: await hashPayload(input.idempotencyKey),
        retryable: false,
        now: current,
      }),
    ]);
    return { sent: false, duplicate: false, status: "UNCERTAIN" };
  }

  await captureResendQuotaHeaders(env.DB, response.headers, now);
  const classification = classifyResendResponse(response.status);
  if (classification === "success") {
    await env.DB.prepare(
      `UPDATE resend_events
       SET status = 'SENT', sent_at = ?, next_attempt_at = ?,
           resend_event_name = ?, last_http_status = ?, last_error_code = NULL
       WHERE idempotency_key = ?`,
    ).bind(current, current, input.event.event, response.status, input.idempotencyKey).run();
    await Promise.all([
      incrementUsageOnce(env.DB, "automation_runs", current, `resend-event:${input.idempotencyKey}`),
      setHealth(env.DB, "last_resend_event", current, "OK", current),
    ]);
    return { sent: true, duplicate: false, status: "SENT" };
  }

  const errorCode = `resend_http_${response.status}`;
  if (classification === "retry") {
    await env.DB.prepare(
      `UPDATE resend_events
       SET status = 'RETRY', next_attempt_at = ?, last_http_status = ?, last_error_code = ?
       WHERE idempotency_key = ?`,
    ).bind(
      new Date(now.getTime() + Math.min(6 * 60 * 60_000, 30_000 * 2 ** existing.attempts)).toISOString(),
      response.status,
      errorCode,
      input.idempotencyKey,
    ).run();
    return { sent: false, duplicate: false, status: "RETRY" };
  }

  await env.DB.prepare(
    `UPDATE resend_events
     SET status = 'DEAD', last_http_status = ?, last_error_code = ?
     WHERE idempotency_key = ?`,
  ).bind(response.status, errorCode, input.idempotencyKey).run();
  await recordLifecycleError(env.DB, {
    component: "resend_event",
    code: errorCode,
    safeMessage: "Resend rejected a lifecycle event.",
    contextHash: await hashPayload(input.idempotencyKey),
    retryable: false,
    now: current,
  });
  return { sent: false, duplicate: false, status: "DEAD" };
}

export async function noteDispatchFailure(
  env: LifecycleEnv,
  component: string,
  error: unknown,
  context: string,
  now = new Date(),
): Promise<void> {
  const code = safeCode(error);
  await recordLifecycleError(env.DB, {
    component,
    code,
    safeMessage: "Lifecycle event dispatch failed.",
    contextHash: await hashPayload(context),
    retryable: code !== "network_outcome_uncertain",
    now: isoNow(now),
  });
}
