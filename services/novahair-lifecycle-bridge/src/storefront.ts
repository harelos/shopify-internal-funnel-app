import { lifecycleConfig } from "./config";
import { hashEmail } from "./crypto";
import { isoNow, recordLifecycleError, scheduleLifecycleEvent } from "./db";
import { FLOW_SPECS } from "./flow-specs";
import type { ConsentState, D1Database, LifecycleEnv, LifecycleFlow } from "./types";

interface IdentityClaimRow {
  claim_id: string;
  shopify_customer_id: string | null;
  email: string | null;
  first_name: string | null;
  visitor_hash: string;
  consent_state: "SUBSCRIBED" | "NOT_SUBSCRIBED" | "UNKNOWN";
  source: string;
  occurred_at: string;
  attempts: number;
}

interface StorefrontEventRow {
  event_id: string;
  visitor_hash: string;
  shopify_customer_id: string | null;
  event_name: "product_viewed" | "product_added_to_cart" | "product_removed_from_cart" | "cart_viewed" | "checkout_started" | "checkout_completed";
  occurred_at: string;
  product_handle: string | null;
  product_name: string | null;
  product_image: string | null;
  variant_id: string | null;
  variant_name: string | null;
  quantity: number | null;
  cart_id: string | null;
  checkout_id: string | null;
  attempts: number;
}

interface IdentityRow {
  identity_id: string;
  shopify_customer_id: string | null;
  email: string;
  consent_state: ConsentState;
}

interface StateRow {
  visitor_hash: string;
  identity_id: string | null;
  stage: "BROWSE" | "CART" | "CHECKOUT" | "PURCHASE";
  last_event_at: string;
}

function normalizedEmail(value: string | null): string | null {
  const email = value?.trim().toLowerCase().slice(0, 254) ?? "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function retryAt(now: Date, attempts: number): string {
  return new Date(now.getTime() + Math.min(6 * 60, 10 * 2 ** Math.min(attempts, 5)) * 60_000).toISOString();
}

async function retryClaim(db: D1Database, row: IdentityClaimRow, now: Date, code: string): Promise<void> {
  await db.prepare(
    `UPDATE lifecycle_identity_claims
     SET attempts = attempts + 1, next_attempt_at = ?, error_code = ?
     WHERE claim_id = ? AND processed_at IS NULL`,
  ).bind(retryAt(now, row.attempts), code, row.claim_id).run();
}

async function identityForClaim(env: LifecycleEnv, row: IdentityClaimRow, now: Date): Promise<IdentityRow | null> {
  const config = lifecycleConfig(env);
  const email = normalizedEmail(row.email);
  const emailHash = email ? await hashEmail(email, config.hashKey) : null;
  const existing = await env.DB.prepare(
    `SELECT identity_id, shopify_customer_id, email, consent_state
     FROM lifecycle_identity_links
     WHERE (? IS NOT NULL AND shopify_customer_id = ?)
        OR (? IS NOT NULL AND email_hash = ?)
     ORDER BY CASE WHEN shopify_customer_id = ? THEN 0 ELSE 1 END
     LIMIT 1`,
  ).bind(row.shopify_customer_id, row.shopify_customer_id, emailHash, emailHash, row.shopify_customer_id).first<IdentityRow>();

  if (existing) {
    const consent = row.consent_state === "SUBSCRIBED" ? "SUBSCRIBED" : existing.consent_state;
    await env.DB.prepare(
      `UPDATE lifecycle_identity_links SET
         shopify_customer_id = COALESCE(?, shopify_customer_id),
         email = COALESCE(?, email),
         first_name = COALESCE(?, first_name),
         visitor_hash = ?, consent_state = ?, consent_updated_at = ?,
         identity_source = ?, verified_at = ?, updated_at = ?
       WHERE identity_id = ?`,
    ).bind(
      row.shopify_customer_id,
      email,
      row.first_name,
      row.visitor_hash,
      consent,
      row.occurred_at,
      row.source,
      row.occurred_at,
      isoNow(now),
      existing.identity_id,
    ).run();
    return { ...existing, shopify_customer_id: row.shopify_customer_id ?? existing.shopify_customer_id, email: email ?? existing.email, consent_state: consent };
  }
  if (!email || !emailHash) return null;
  const identityId = `identity:${emailHash}`;
  await env.DB.prepare(
    `INSERT INTO lifecycle_identity_links (
       identity_id, shopify_customer_id, email, email_hash, first_name, visitor_hash,
       consent_state, consent_updated_at, identity_source, verified_at,
       lifecycle_stage, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'WELCOME', ?, ?)`,
  ).bind(
    identityId,
    row.shopify_customer_id,
    email,
    emailHash,
    row.first_name,
    row.visitor_hash,
    row.consent_state,
    row.occurred_at,
    row.source,
    row.occurred_at,
    isoNow(now),
    isoNow(now),
  ).run();
  return { identity_id: identityId, shopify_customer_id: row.shopify_customer_id, email, consent_state: row.consent_state };
}

export async function processLifecycleIdentityClaims(env: LifecycleEnv, now = new Date()): Promise<{ processed: number; pending: number }> {
  const current = isoNow(now);
  const rows = await env.DB.prepare(
    `SELECT claim_id, shopify_customer_id, email, first_name, visitor_hash,
            consent_state, source, occurred_at, attempts
     FROM lifecycle_identity_claims
     WHERE processed_at IS NULL AND next_attempt_at <= ? AND attempts < 12
     ORDER BY occurred_at ASC LIMIT 50`,
  ).bind(current).all<IdentityClaimRow>();
  let processed = 0;
  let pending = 0;
  for (const row of rows.results ?? []) {
    try {
      const identity = await identityForClaim(env, row, now);
      if (!identity) {
        await retryClaim(env.DB, row, now, "identity_not_yet_available");
        pending += 1;
        continue;
      }
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE lifecycle_identity_claims
           SET processed_at = ?, error_code = NULL, email = NULL, first_name = NULL
           WHERE claim_id = ?`,
        ).bind(current, row.claim_id),
        env.DB.prepare(
          "UPDATE storefront_lifecycle_state SET identity_id = ?, updated_at = ? WHERE visitor_hash = ?",
        ).bind(identity.identity_id, current, row.visitor_hash),
      ]);
      processed += 1;
    } catch (error) {
      await retryClaim(env.DB, row, now, error instanceof Error ? error.message.slice(0, 100) : "claim_processing_failed");
      pending += 1;
    }
  }
  return { processed, pending };
}

async function resolveIdentity(env: LifecycleEnv, row: StorefrontEventRow): Promise<IdentityRow | null> {
  return env.DB.prepare(
    `SELECT identity_id, shopify_customer_id, email, consent_state
     FROM lifecycle_identity_links
     WHERE visitor_hash = ? OR (? IS NOT NULL AND shopify_customer_id = ?)
     ORDER BY CASE WHEN visitor_hash = ? THEN 0 ELSE 1 END
     LIMIT 1`,
  ).bind(row.visitor_hash, row.shopify_customer_id, row.shopify_customer_id, row.visitor_hash).first<IdentityRow>();
}

async function cancelPendingFlow(db: D1Database, identityId: string, flow: LifecycleFlow, now: string): Promise<void> {
  await db.prepare(
    `UPDATE scheduled_lifecycle_events
     SET status = 'CANCELLED', lease_until = NULL,
         last_error_code = 'storefront_stage_advanced', updated_at = ?
     WHERE entity_type = 'identity' AND entity_id = ? AND flow = ?
       AND status IN ('PENDING', 'RETRY', 'LEASED')`,
  ).bind(now, identityId, flow).run();
}

async function queueStop(env: LifecycleEnv, row: StorefrontEventRow, identity: IdentityRow, flow: "abandoned_cart" | "browse_abandonment", now: string): Promise<void> {
  await scheduleLifecycleEvent(env.DB, {
    idempotencyKey: `storefront:${row.event_id}:${flow}:stop`,
    eventName: flow === "abandoned_cart" ? "lifecycle.cart_stop" : "lifecycle.browse_stop",
    flow,
    emailNumber: 0,
    entityType: "identity",
    entityId: identity.identity_id,
    dueAt: now,
    now,
  });
}

async function advancePastFlow(env: LifecycleEnv, row: StorefrontEventRow, identity: IdentityRow, flow: "abandoned_cart" | "browse_abandonment", now: string): Promise<void> {
  await cancelPendingFlow(env.DB, identity.identity_id, flow, now);
  await queueStop(env, row, identity, flow, now);
}

async function scheduleAbandonment(env: LifecycleEnv, row: StorefrontEventRow, identity: IdentityRow, flow: "abandoned_cart" | "browse_abandonment", now: string): Promise<void> {
  const delay = FLOW_SPECS[flow].triggerDelayMinutes ?? 0;
  const dueAt = new Date(new Date(row.occurred_at).getTime() + delay * 60_000).toISOString();
  await cancelPendingFlow(env.DB, identity.identity_id, flow, now);
  await scheduleLifecycleEvent(env.DB, {
    idempotencyKey: `storefront:${row.event_id}:${flow}:trigger`,
    eventName: FLOW_SPECS[flow].triggerEvent,
    flow,
    emailNumber: 0,
    entityType: "identity",
    entityId: identity.identity_id,
    dueAt,
    now,
  });
}

async function upsertState(env: LifecycleEnv, row: StorefrontEventRow, identity: IdentityRow, stage: StateRow["stage"], now: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO storefront_lifecycle_state (
       visitor_hash, identity_id, stage, last_event_at, last_product_handle,
       last_product_name, last_product_image, last_variant_id, last_variant_name,
       last_cart_id, last_checkout_id, browse_generation, cart_generation,
       checkout_at, purchase_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(visitor_hash) DO UPDATE SET
       identity_id = excluded.identity_id,
       stage = excluded.stage,
       last_event_at = excluded.last_event_at,
       last_product_handle = COALESCE(excluded.last_product_handle, storefront_lifecycle_state.last_product_handle),
       last_product_name = COALESCE(excluded.last_product_name, storefront_lifecycle_state.last_product_name),
       last_product_image = COALESCE(excluded.last_product_image, storefront_lifecycle_state.last_product_image),
       last_variant_id = COALESCE(excluded.last_variant_id, storefront_lifecycle_state.last_variant_id),
       last_variant_name = COALESCE(excluded.last_variant_name, storefront_lifecycle_state.last_variant_name),
       last_cart_id = COALESCE(excluded.last_cart_id, storefront_lifecycle_state.last_cart_id),
       last_checkout_id = COALESCE(excluded.last_checkout_id, storefront_lifecycle_state.last_checkout_id),
       browse_generation = storefront_lifecycle_state.browse_generation + ?,
       cart_generation = storefront_lifecycle_state.cart_generation + ?,
       checkout_at = COALESCE(excluded.checkout_at, storefront_lifecycle_state.checkout_at),
       purchase_at = COALESCE(excluded.purchase_at, storefront_lifecycle_state.purchase_at),
       updated_at = excluded.updated_at
     WHERE excluded.last_event_at >= storefront_lifecycle_state.last_event_at`,
  ).bind(
    row.visitor_hash,
    identity.identity_id,
    stage,
    row.occurred_at,
    row.product_handle,
    row.product_name,
    row.product_image,
    row.variant_id,
    row.variant_name,
    row.cart_id,
    row.checkout_id,
    stage === "BROWSE" ? 1 : 0,
    stage === "CART" ? 1 : 0,
    stage === "CHECKOUT" ? row.occurred_at : null,
    stage === "PURCHASE" ? row.occurred_at : null,
    now,
    stage === "BROWSE" ? 1 : 0,
    stage === "CART" ? 1 : 0,
  ).run();
  await env.DB.prepare(
    `UPDATE lifecycle_identity_links SET
       last_product_handle = COALESCE(?, last_product_handle),
       last_cart_id = COALESCE(?, last_cart_id),
       last_checkout_id = COALESCE(?, last_checkout_id),
       lifecycle_stage = ?, updated_at = ?
     WHERE identity_id = ?`,
  ).bind(
    row.product_handle,
    row.cart_id,
    row.checkout_id,
    stage,
    now,
    identity.identity_id,
  ).run();
}

async function retryStorefrontEvent(env: LifecycleEnv, row: StorefrontEventRow, now: Date, code: string): Promise<void> {
  if (row.attempts >= 143) {
    await env.DB.prepare(
      "UPDATE storefront_lifecycle_events SET processed_at = ?, error_code = ? WHERE event_id = ?",
    ).bind(isoNow(now), "identity_unresolved_expired", row.event_id).run();
    return;
  }
  await env.DB.prepare(
    `UPDATE storefront_lifecycle_events
     SET attempts = attempts + 1, next_attempt_at = ?, error_code = ?
     WHERE event_id = ? AND processed_at IS NULL`,
  ).bind(retryAt(now, row.attempts), code.slice(0, 100), row.event_id).run();
}

export async function processStorefrontLifecycleEvents(env: LifecycleEnv, now = new Date()): Promise<{ processed: number; pendingIdentity: number }> {
  const current = isoNow(now);
  const rows = await env.DB.prepare(
    `SELECT event_id, visitor_hash, shopify_customer_id, event_name, occurred_at,
            product_handle, product_name, product_image, variant_id, variant_name,
            quantity, cart_id, checkout_id, attempts
     FROM storefront_lifecycle_events
     WHERE processed_at IS NULL AND next_attempt_at <= ?
     ORDER BY occurred_at ASC LIMIT 100`,
  ).bind(current).all<StorefrontEventRow>();
  let processed = 0;
  let pendingIdentity = 0;
  for (const row of rows.results ?? []) {
    try {
      const identity = await resolveIdentity(env, row);
      if (!identity) {
        await retryStorefrontEvent(env, row, now, "identity_not_yet_available");
        pendingIdentity += 1;
        continue;
      }
      const prior = await env.DB.prepare(
        "SELECT visitor_hash, identity_id, stage, last_event_at FROM storefront_lifecycle_state WHERE visitor_hash = ?",
      ).bind(row.visitor_hash).first<StateRow>();
      if (prior && row.occurred_at < prior.last_event_at) {
        await env.DB.prepare(
          "UPDATE storefront_lifecycle_events SET processed_at = ?, error_code = 'superseded_by_newer_event' WHERE event_id = ?",
        ).bind(current, row.event_id).run();
        processed += 1;
        continue;
      }

      if (row.event_name === "product_viewed") {
        const cartStillActive = prior?.stage === "CART";
        await upsertState(env, row, identity, cartStillActive ? "CART" : "BROWSE", current);
        if (!cartStillActive && identity.consent_state === "SUBSCRIBED") {
          await scheduleAbandonment(env, row, identity, "browse_abandonment", current);
        }
      } else if (row.event_name === "product_removed_from_cart") {
        await advancePastFlow(env, row, identity, "abandoned_cart", current);
        await upsertState(env, row, identity, "BROWSE", current);
      } else if (row.event_name === "product_added_to_cart" || row.event_name === "cart_viewed") {
        await advancePastFlow(env, row, identity, "browse_abandonment", current);
        await upsertState(env, row, identity, "CART", current);
        if (identity.consent_state === "SUBSCRIBED") {
          await scheduleAbandonment(env, row, identity, "abandoned_cart", current);
        }
      } else if (row.event_name === "checkout_started") {
        await advancePastFlow(env, row, identity, "browse_abandonment", current);
        await advancePastFlow(env, row, identity, "abandoned_cart", current);
        await upsertState(env, row, identity, "CHECKOUT", current);
      } else {
        await advancePastFlow(env, row, identity, "browse_abandonment", current);
        await advancePastFlow(env, row, identity, "abandoned_cart", current);
        await upsertState(env, row, identity, "PURCHASE", current);
      }
      await env.DB.prepare(
        "UPDATE storefront_lifecycle_events SET processed_at = ?, error_code = NULL WHERE event_id = ?",
      ).bind(current, row.event_id).run();
      processed += 1;
    } catch (error) {
      const code = error instanceof Error ? error.message : "storefront_event_processing_failed";
      await retryStorefrontEvent(env, row, now, code);
      await recordLifecycleError(env.DB, {
        component: "storefront_lifecycle",
        code,
        safeMessage: "A storefront lifecycle event could not be processed.",
        contextHash: row.event_id,
        retryable: true,
        now: current,
      });
    }
  }
  return { processed, pendingIdentity };
}
