import { randomOpaqueToken } from "./crypto";
import type {
  D1Database,
  LifecycleFlow,
  ScheduledLifecycleRow,
} from "./types";

export function isoNow(now = new Date()): string {
  return now.toISOString();
}

export async function setHealth(
  db: D1Database,
  key: string,
  value: string,
  status = "OK",
  now = isoNow(),
): Promise<void> {
  await db.prepare(
    `INSERT INTO health_state (key, value, status, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       status = excluded.status,
       updated_at = excluded.updated_at`,
  ).bind(key, value, status, now).run();
}

export async function healthValue(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM health_state WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function recordLifecycleError(
  db: D1Database,
  input: {
    component: string;
    code: string;
    safeMessage: string;
    contextHash?: string;
    retryable: boolean;
    now?: string;
  },
): Promise<void> {
  await db.prepare(
    `INSERT INTO lifecycle_errors
      (component, error_code, safe_message, context_hash, retryable, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(
    input.component.slice(0, 80),
    input.code.slice(0, 100),
    input.safeMessage.slice(0, 500),
    input.contextHash?.slice(0, 128) ?? null,
    input.retryable ? 1 : 0,
    input.now ?? isoNow(),
  ).run();
}

export async function acquireCronLock(
  db: D1Database,
  lockName: string,
  owner: string,
  now: Date,
  leaseSeconds = 240,
): Promise<boolean> {
  const current = isoNow(now);
  const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000).toISOString();
  await db.prepare(
    `INSERT INTO lifecycle_cron_locks (lock_name, lease_owner, lease_until, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(lock_name) DO UPDATE SET
       lease_owner = excluded.lease_owner,
       lease_until = excluded.lease_until,
       updated_at = excluded.updated_at
     WHERE lifecycle_cron_locks.lease_until < ?`,
  ).bind(lockName, owner, leaseUntil, current, current).run();
  const row = await db.prepare(
    "SELECT lease_owner, lease_until FROM lifecycle_cron_locks WHERE lock_name = ?",
  ).bind(lockName).first<{ lease_owner: string; lease_until: string }>();
  return row?.lease_owner === owner && row.lease_until === leaseUntil;
}

export async function releaseCronLock(db: D1Database, lockName: string, owner: string): Promise<void> {
  await db.prepare(
    "DELETE FROM lifecycle_cron_locks WHERE lock_name = ? AND lease_owner = ?",
  ).bind(lockName, owner).run();
}

export async function scheduleLifecycleEvent(
  db: D1Database,
  input: {
    idempotencyKey: string;
    eventName: string;
    flow: LifecycleFlow;
    emailNumber: number;
    entityType: string;
    entityId: string;
    dueAt: string;
    now?: string;
  },
): Promise<void> {
  const now = input.now ?? isoNow();
  await db.prepare(
    `INSERT OR IGNORE INTO scheduled_lifecycle_events
      (idempotency_key, event_name, flow, email_number, entity_type, entity_id,
       due_at, status, attempts, max_attempts, next_attempt_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, 7, ?, ?, ?)`,
  ).bind(
    input.idempotencyKey,
    input.eventName,
    input.flow,
    input.emailNumber,
    input.entityType,
    input.entityId,
    input.dueAt,
    input.dueAt,
    now,
    now,
  ).run();
}

export async function cancelEntitySchedules(
  db: D1Database,
  entityType: string,
  entityId: string,
  now = isoNow(),
): Promise<void> {
  await db.prepare(
    `UPDATE scheduled_lifecycle_events
     SET status = 'CANCELLED', lease_until = NULL, updated_at = ?
     WHERE entity_type = ? AND entity_id = ? AND status IN ('PENDING', 'RETRY', 'LEASED')`,
  ).bind(now, entityType, entityId).run();
}

export async function leaseDueSchedules(
  db: D1Database,
  now: Date,
  owner: string,
  limit = 25,
): Promise<ScheduledLifecycleRow[]> {
  const current = isoNow(now);
  const leaseUntil = new Date(now.getTime() + 120_000).toISOString();
  const candidates = await db.prepare(
    `SELECT idempotency_key
     FROM scheduled_lifecycle_events
     WHERE due_at <= ?
       AND next_attempt_at <= ?
       AND (
         status IN ('PENDING', 'RETRY')
         OR (status = 'LEASED' AND lease_until < ?)
       )
     ORDER BY due_at ASC
     LIMIT ?`,
  ).bind(current, current, current, limit).all<{ idempotency_key: string }>();
  const keys = candidates.results?.map(row => row.idempotency_key) ?? [];
  const leased: ScheduledLifecycleRow[] = [];
  for (const key of keys) {
    await db.prepare(
      `UPDATE scheduled_lifecycle_events
       SET status = 'LEASED', lease_until = ?, updated_at = ?, last_error_code = NULL
       WHERE idempotency_key = ?
         AND (
           status IN ('PENDING', 'RETRY')
           OR (status = 'LEASED' AND lease_until < ?)
         )`,
    ).bind(leaseUntil, current, key, current).run();
    const row = await db.prepare(
      `SELECT idempotency_key, event_name, flow, email_number, entity_type, entity_id,
              due_at, status, attempts, max_attempts, lease_until, next_attempt_at
       FROM scheduled_lifecycle_events
       WHERE idempotency_key = ? AND status = 'LEASED' AND lease_until = ?`,
    ).bind(key, leaseUntil).first<ScheduledLifecycleRow>();
    if (row) leased.push(row);
  }
  await setHealth(db, "last_schedule_lease_owner", owner, "OK", current);
  return leased;
}

export async function markScheduleDispatched(
  db: D1Database,
  idempotencyKey: string,
  now = isoNow(),
): Promise<void> {
  await db.prepare(
    `UPDATE scheduled_lifecycle_events
     SET status = 'DISPATCHED', dispatched_at = ?, lease_until = NULL,
         attempts = attempts + 1, updated_at = ?
     WHERE idempotency_key = ? AND status = 'LEASED'`,
  ).bind(now, now, idempotencyKey).run();
}

export async function markScheduleCancelled(
  db: D1Database,
  idempotencyKey: string,
  reason: string,
  now = isoNow(),
): Promise<void> {
  await db.prepare(
    `UPDATE scheduled_lifecycle_events
     SET status = 'CANCELLED', lease_until = NULL, last_error_code = ?, updated_at = ?
     WHERE idempotency_key = ? AND status IN ('PENDING', 'RETRY', 'LEASED')`,
  ).bind(reason.slice(0, 100), now, idempotencyKey).run();
}

export async function markScheduleDead(
  db: D1Database,
  idempotencyKey: string,
  reason: string,
  now = isoNow(),
): Promise<void> {
  await db.prepare(
    `UPDATE scheduled_lifecycle_events
     SET status = 'DEAD', lease_until = NULL, last_error_code = ?, updated_at = ?
     WHERE idempotency_key = ?`,
  ).bind(reason.slice(0, 100), now, idempotencyKey).run();
}

function retryDelaySeconds(attempts: number): number {
  const base = Math.min(6 * 60 * 60, 30 * 2 ** Math.max(0, attempts));
  const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(base * 0.2)));
  return base + jitter;
}

export async function markScheduleRetry(
  db: D1Database,
  row: ScheduledLifecycleRow,
  errorCode: string,
  now = new Date(),
): Promise<void> {
  const attempts = row.attempts + 1;
  const dead = attempts >= row.max_attempts;
  const next = new Date(now.getTime() + retryDelaySeconds(attempts) * 1000).toISOString();
  await db.prepare(
    `UPDATE scheduled_lifecycle_events
     SET status = ?, attempts = ?, next_attempt_at = ?, lease_until = NULL,
         last_error_code = ?, updated_at = ?
     WHERE idempotency_key = ?`,
  ).bind(
    dead ? "DEAD" : "RETRY",
    attempts,
    next,
    errorCode.slice(0, 100),
    isoNow(now),
    row.idempotency_key,
  ).run();
}

export async function createClickToken(
  db: D1Database,
  input: {
    entityType: string;
    entityId: string;
    flow: LifecycleFlow;
    emailNumber: number;
    encryptedTargetUrl: string;
    utmCampaign: string;
    utmContent: string;
    now?: Date;
  },
): Promise<string> {
  const existing = await db.prepare(
    `SELECT token FROM lifecycle_click_tokens
     WHERE entity_type = ? AND entity_id = ? AND flow = ? AND email_number = ?
     ORDER BY created_at DESC LIMIT 1`,
  ).bind(input.entityType, input.entityId, input.flow, input.emailNumber).first<{ token: string }>();
  if (existing?.token) return existing.token;

  const now = input.now ?? new Date();
  const expires = new Date(now.getTime() + 180 * 86_400_000).toISOString();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = randomOpaqueToken();
    const result = await db.prepare(
      `INSERT OR IGNORE INTO lifecycle_click_tokens
        (token, entity_type, entity_id, flow, email_number, target_url,
         utm_campaign, utm_content, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      token,
      input.entityType,
      input.entityId,
      input.flow,
      input.emailNumber,
      input.encryptedTargetUrl,
      input.utmCampaign,
      input.utmContent,
      isoNow(now),
      expires,
    ).run();
    if (result.success) return token;
  }
  throw new Error("click_token_creation_failed");
}

export interface ClickTokenRow {
  token: string;
  entity_type: string;
  entity_id: string;
  flow: LifecycleFlow;
  email_number: number;
  target_url: string;
  utm_campaign: string;
  utm_content: string;
  expires_at: string;
}

export async function consumeClickToken(
  db: D1Database,
  token: string,
  now = new Date(),
): Promise<ClickTokenRow | null> {
  const current = isoNow(now);
  const row = await db.prepare(
    `SELECT token, entity_type, entity_id, flow, email_number, target_url,
            utm_campaign, utm_content, expires_at
     FROM lifecycle_click_tokens
     WHERE token = ? AND expires_at > ?`,
  ).bind(token, current).first<ClickTokenRow>();
  if (!row) return null;
  await db.prepare(
    `UPDATE lifecycle_click_tokens
     SET click_count = click_count + 1,
         first_clicked_at = COALESCE(first_clicked_at, ?),
         last_clicked_at = ?
     WHERE token = ?`,
  ).bind(current, current, token).run();
  return row;
}

export async function incrementUsageOnce(
  db: D1Database,
  kind: "emails_sent" | "automation_runs",
  occurredAt: string,
  sourceKey: string,
): Promise<void> {
  const date = new Date(occurredAt);
  const day = date.toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  const column = kind === "emails_sent" ? "emails_sent" : "automation_runs";
  const statements = [
    db.prepare(
      `INSERT OR IGNORE INTO lifecycle_usage_event_receipts
        (source_key, kind, occurred_at, counted_at)
       VALUES (?, ?, ?, NULL)`,
    ).bind(sourceKey, kind, occurredAt),
    ...([["DAY", day], ["MONTH", month]] as const).map(([periodType, periodKey]) => db.prepare(
      `INSERT INTO lifecycle_usage_counters
        (period_type, period_key, ${column}, updated_at)
       SELECT ?, ?, 1, ?
       FROM lifecycle_usage_event_receipts
       WHERE source_key = ? AND kind = ? AND counted_at IS NULL
       ON CONFLICT(period_type, period_key) DO UPDATE SET
         ${column} = ${column} + 1,
         updated_at = excluded.updated_at`,
    ).bind(periodType, periodKey, occurredAt, sourceKey, kind)),
    db.prepare(
      `UPDATE lifecycle_usage_event_receipts
       SET counted_at = ?
       WHERE source_key = ? AND kind = ? AND counted_at IS NULL`,
    ).bind(occurredAt, sourceKey, kind),
  ];
  await db.batch(statements);
}

export interface UsageSnapshot {
  dayEmails: number;
  monthEmails: number;
  monthRuns: number;
  localDayEmails: number;
  localMonthEmails: number;
  localMonthRuns: number;
  observedDayEmails: number | null;
  observedMonthEmails: number | null;
  warning: boolean;
  critical: boolean;
  dispatchAllowed: boolean;
}

export async function usageSnapshot(db: D1Database, now = new Date()): Promise<UsageSnapshot> {
  const day = now.toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  const daily = await db.prepare(
    "SELECT emails_sent, automation_runs FROM lifecycle_usage_counters WHERE period_type = 'DAY' AND period_key = ?",
  ).bind(day).first<{ emails_sent: number; automation_runs: number }>();
  const monthly = await db.prepare(
    "SELECT emails_sent, automation_runs FROM lifecycle_usage_counters WHERE period_type = 'MONTH' AND period_key = ?",
  ).bind(month).first<{ emails_sent: number; automation_runs: number }>();
  const localDayEmails = daily?.emails_sent ?? 0;
  const localMonthEmails = monthly?.emails_sent ?? 0;
  const localMonthRuns = monthly?.automation_runs ?? 0;
  const observed = await db.prepare(
    "SELECT value FROM health_state WHERE key = 'resend_quota_observed'",
  ).first<{ value: string }>();
  let observedDayEmails: number | null = null;
  let observedMonthEmails: number | null = null;
  if (observed?.value) {
    try {
      const parsed = JSON.parse(observed.value) as {
        dayKey?: string;
        monthKey?: string;
        dayEmails?: number;
        monthEmails?: number;
      };
      if (parsed.dayKey === day && Number.isFinite(parsed.dayEmails)) {
        observedDayEmails = Math.max(0, Number(parsed.dayEmails));
      }
      if (parsed.monthKey === month && Number.isFinite(parsed.monthEmails)) {
        observedMonthEmails = Math.max(0, Number(parsed.monthEmails));
      }
    } catch {
      // A malformed observation must never weaken the local quota guard.
    }
  }
  const dayEmails = Math.max(localDayEmails, observedDayEmails ?? 0);
  const monthEmails = Math.max(localMonthEmails, observedMonthEmails ?? 0);
  const monthRuns = localMonthRuns;
  return {
    dayEmails,
    monthEmails,
    monthRuns,
    localDayEmails,
    localMonthEmails,
    localMonthRuns,
    observedDayEmails,
    observedMonthEmails,
    warning: dayEmails >= 70 || monthEmails >= 2400 || monthRuns >= 9000,
    critical: dayEmails >= 90 || monthEmails >= 2900 || monthRuns >= 9800,
    dispatchAllowed: dayEmails < 90 && monthEmails < 2900 && monthRuns < 9800,
  };
}
