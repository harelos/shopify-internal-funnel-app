import { canDispatchTo, lifecycleConfig } from "./config";
import { decryptSensitive, encryptSensitive, hashEmail } from "./crypto";
import {
  createClickToken,
  isoNow,
  leaseDueSchedules,
  markScheduleCancelled,
  markScheduleDead,
  markScheduleDispatched,
  markScheduleRetry,
  setHealth,
} from "./db";
import { emailSpec, FLOW_SPECS } from "./flow-specs";
import { noteDispatchFailure, sendLifecycleEvent } from "./resend";
import { appendLifecycleUtm, assertRecoveryIdentityPreserved, safeStorefrontUrl } from "./url";
import type {
  AbandonedCheckoutRow,
  ConsentState,
  LifecycleEnv,
  LifecycleFlow,
  NormalizedLifecyclePayload,
  OutboundLifecycleEvent,
  ScheduledLifecycleRow,
} from "./types";

interface IdentityRow {
  identity_id: string;
  shopify_customer_id: string | null;
  email: string;
  first_name: string | null;
  consent_state: ConsentState;
  last_product_handle: string | null;
}

interface OrderRow {
  shopify_order_id: string;
  shopify_checkout_id: string | null;
  shopify_customer_id: string | null;
  email: string | null;
  first_name: string | null;
  consent_state: ConsentState;
  completed_at: string;
  bundle: string | null;
  quantity: number;
  shade: string | null;
  product_name: string | null;
  total: number | null;
  currency: string | null;
}

interface Dispatchable {
  event: OutboundLifecycleEvent;
  emailNumber: number;
  flow: LifecycleFlow;
  templateAlias?: string;
}

function storefrontDomain(config: ReturnType<typeof lifecycleConfig>): string {
  return config.storefrontDomain;
}

async function localSuppression(env: LifecycleEnv, emailHash: string | null): Promise<boolean> {
  if (!emailHash) return false;
  const row = await env.DB.prepare(
    "SELECT active FROM suppressions WHERE email_hash = ? AND active = 1",
  ).bind(emailHash).first<{ active: number }>();
  return row?.active === 1;
}

async function trackingUrl(
  env: LifecycleEnv,
  input: {
    entityType: string;
    entityId: string;
    flow: LifecycleFlow;
    emailNumber: number;
    target: string;
  },
): Promise<string> {
  const config = lifecycleConfig(env);
  if (!config.appUrl) throw new Error("app_url_missing");
  const spec = emailSpec(input.flow, input.emailNumber);
  const attributed = appendLifecycleUtm(input.target, input.flow, spec.content);
  assertRecoveryIdentityPreserved(input.target, attributed.url);
  const token = await createClickToken(env.DB, {
    entityType: input.entityType,
    entityId: input.entityId,
    flow: input.flow,
    emailNumber: input.emailNumber,
    encryptedTargetUrl: await encryptSensitive(attributed.url, config.dataKey),
    utmCampaign: attributed.utm.campaign,
    utmContent: attributed.utm.content,
  });
  return `${config.appUrl}/api/lifecycle/click/${token}`;
}

function basePayload(input: {
  eventKey: string;
  occurredAt: string;
  consentState: ConsentState;
  flow?: LifecycleFlow;
  emailNumber?: number;
  firstName?: string | null;
  customerId?: string | null;
  checkoutId?: string | null;
  orderId?: string | null;
  productName?: string | null;
  productImage?: string | null;
  variant?: string | null;
  shade?: string | null;
  bundle?: string | null;
  quantity?: number | null;
  total?: number | null;
  currency?: string | null;
  isTest: boolean;
}): NormalizedLifecyclePayload {
  const payload: NormalizedLifecyclePayload = {
    event_key: input.eventKey,
    consent_state: input.consentState,
    occurred_at: input.occurredAt,
    is_test: input.isTest,
  };
  if (input.flow) payload.flow = input.flow;
  if (input.emailNumber !== undefined) payload.email_number = input.emailNumber;
  if (input.firstName) payload.first_name = input.firstName;
  if (input.customerId) payload.customer_id = input.customerId;
  if (input.checkoutId) payload.checkout_id = input.checkoutId;
  if (input.orderId) payload.order_id = input.orderId;
  if (input.productName) payload.product_name = input.productName;
  if (input.productImage) payload.product_image = input.productImage;
  if (input.variant) payload.variant = input.variant;
  if (input.shade) payload.shade = input.shade;
  if (input.bundle) payload.bundle = input.bundle;
  if (input.quantity !== null && input.quantity !== undefined) payload.quantity = input.quantity;
  if (input.total !== null && input.total !== undefined) payload.total = input.total;
  if (input.currency) payload.currency = input.currency;
  return payload;
}

async function nativeFlowUrls(
  env: LifecycleEnv,
  input: {
    entityType: string;
    entityId: string;
    flow: LifecycleFlow;
    target: string;
    payload: NormalizedLifecyclePayload;
  },
): Promise<void> {
  for (const spec of FLOW_SPECS[input.flow].emails) {
    const key = `cta_url_e${String(spec.number).padStart(2, "0")}` as const;
    input.payload[key] = await trackingUrl(env, {
      entityType: input.entityType,
      entityId: input.entityId,
      flow: input.flow,
      emailNumber: spec.number,
      target: input.target,
    });
  }
}

async function checkoutEvent(env: LifecycleEnv, row: ScheduledLifecycleRow): Promise<Dispatchable | null> {
  const checkout = await env.DB.prepare(
    `SELECT shopify_checkout_id, shop_domain, customer_id, email, email_hash, first_name,
            checkout_url, created_at, updated_at, completed_at, first_seen_at, last_seen_at,
            automation_triggered_at, recovery_event_sent_at, purchase_event_sent_at,
            consent_state, state, next_email_number, next_due_at, payload_hash,
            product_name, product_image, variant, shade, bundle, quantity, total, currency
     FROM abandoned_checkouts WHERE shopify_checkout_id = ?`,
  ).bind(row.entity_id).first<AbandonedCheckoutRow>();
  if (!checkout?.email) return null;

  const isTest = lifecycleConfig(env).mode === "test";
  if (row.event_name === "lifecycle.browse_stop" || row.event_name === "lifecycle.cart_stop") {
    if (!canDispatchTo(env, checkout.email)) return null;
    return {
      flow: row.flow,
      emailNumber: 0,
      event: {
        event: row.event_name,
        email: checkout.email,
        payload: basePayload({
          eventKey: row.idempotency_key,
          occurredAt: checkout.updated_at,
          consentState: checkout.consent_state,
          flow: row.flow,
          customerId: checkout.customer_id,
          checkoutId: checkout.shopify_checkout_id,
          isTest,
        }),
      },
    };
  }
  if (row.event_name === "shopify.checkout_recovered") {
    if (!["RECOVERED", "PURCHASED"].includes(checkout.state)) return null;
    return {
      flow: "abandoned_checkout",
      emailNumber: 0,
      event: {
        event: "shopify.checkout_recovered",
        email: checkout.email,
        payload: basePayload({
          eventKey: row.idempotency_key,
          occurredAt: checkout.completed_at ?? isoNow(),
          consentState: checkout.consent_state,
          flow: "abandoned_checkout",
          customerId: checkout.customer_id,
          checkoutId: checkout.shopify_checkout_id,
          isTest,
        }),
      },
    };
  }

  if (checkout.state !== "ABANDONED" || checkout.completed_at) return null;
  if (checkout.consent_state !== "SUBSCRIBED") return null;
  if (await localSuppression(env, checkout.email_hash)) return null;
  if (!canDispatchTo(env, checkout.email)) return null;

  const recoveryUrl = await decryptSensitive(checkout.checkout_url, lifecycleConfig(env).dataKey);
  const ctaUrl = await trackingUrl(env, {
    entityType: "checkout",
    entityId: checkout.shopify_checkout_id,
    flow: "abandoned_checkout",
    emailNumber: row.email_number,
    target: recoveryUrl,
  });
  const payload = basePayload({
    eventKey: row.idempotency_key,
    occurredAt: checkout.created_at,
    consentState: checkout.consent_state,
    flow: "abandoned_checkout",
    emailNumber: row.email_number,
    firstName: checkout.first_name,
    customerId: checkout.customer_id,
    checkoutId: checkout.shopify_checkout_id,
    productName: checkout.product_name,
    productImage: checkout.product_image,
    variant: checkout.variant,
    shade: checkout.shade,
    bundle: checkout.bundle,
    quantity: checkout.quantity,
    total: checkout.total,
    currency: checkout.currency,
    isTest,
  });
  payload.cta_url = ctaUrl;
  return {
    flow: "abandoned_checkout",
    emailNumber: row.email_number,
    templateAlias: `novahair_abandoned_checkout_e${String(row.email_number).padStart(2, "0")}`,
    event: { event: "shopify.checkout_abandoned", email: checkout.email, payload },
  };
}

async function identityEvent(env: LifecycleEnv, row: ScheduledLifecycleRow): Promise<Dispatchable | null> {
  const identity = await env.DB.prepare(
    `SELECT identity_id, shopify_customer_id, email, first_name, consent_state, last_product_handle
     FROM lifecycle_identity_links WHERE identity_id = ?`,
  ).bind(row.entity_id).first<IdentityRow>();
  if (!identity || identity.consent_state !== "SUBSCRIBED" || !canDispatchTo(env, identity.email)) return null;
  const config = lifecycleConfig(env);
  const target = safeStorefrontUrl(
    storefrontDomain(config),
    identity.last_product_handle ? `/products/${encodeURIComponent(identity.last_product_handle)}` : "/pages/novahair-sales",
  );
  const payload = basePayload({
    eventKey: row.idempotency_key,
    occurredAt: isoNow(),
    consentState: identity.consent_state,
    flow: row.flow,
    firstName: identity.first_name,
    customerId: identity.shopify_customer_id,
    isTest: config.mode === "test",
  });
  await nativeFlowUrls(env, {
    entityType: "identity",
    entityId: identity.identity_id,
    flow: row.flow,
    target,
    payload,
  });
  return { flow: row.flow, emailNumber: 0, event: { event: row.event_name, email: identity.email, payload } };
}

async function orderEvent(env: LifecycleEnv, row: ScheduledLifecycleRow): Promise<Dispatchable | null> {
  const order = await env.DB.prepare(
    `SELECT shopify_order_id, shopify_checkout_id, shopify_customer_id, email, first_name,
            consent_state, completed_at, bundle, quantity, shade, product_name, total, currency
     FROM lifecycle_orders WHERE shopify_order_id = ?`,
  ).bind(row.entity_id).first<OrderRow>();
  if (!order?.email || !canDispatchTo(env, order.email)) return null;
  const config = lifecycleConfig(env);
  const payload = basePayload({
    eventKey: row.idempotency_key,
    occurredAt: order.completed_at,
    consentState: order.consent_state,
    flow: row.flow,
    customerId: order.shopify_customer_id,
    checkoutId: order.shopify_checkout_id,
    orderId: order.shopify_order_id,
    firstName: order.first_name,
    bundle: order.bundle,
    quantity: order.quantity,
    shade: order.shade,
    productName: order.product_name,
    total: order.total,
    currency: order.currency,
    isTest: config.mode === "test",
  });
  if (row.event_name === "shopify.post_purchase_started" || row.event_name === "shopify.replenishment_due") {
    await nativeFlowUrls(env, {
      entityType: "order",
      entityId: order.shopify_order_id,
      flow: row.flow,
      target: safeStorefrontUrl(storefrontDomain(config), "/pages/novahair-sales"),
      payload,
    });
  }
  return { flow: row.flow, emailNumber: 0, event: { event: row.event_name, email: order.email, payload } };
}

async function buildDispatchable(env: LifecycleEnv, row: ScheduledLifecycleRow): Promise<Dispatchable | null> {
  if (row.entity_type === "checkout") return checkoutEvent(env, row);
  if (row.entity_type === "identity") return identityEvent(env, row);
  if (row.entity_type === "order") return orderEvent(env, row);
  return null;
}

async function recordAutomationTracking(
  env: LifecycleEnv,
  row: ScheduledLifecycleRow,
  dispatchable: Dispatchable,
  now: string,
): Promise<void> {
  if (!dispatchable.templateAlias || dispatchable.emailNumber < 1) {
    const recipientHash = await hashEmail(dispatchable.event.email, lifecycleConfig(env).hashKey);
    const specs = FLOW_SPECS[dispatchable.flow].emails;
    for (const nativeSpec of specs) {
      const alias = `novahair_${dispatchable.flow}_e${String(nativeSpec.number).padStart(2, "0")}`;
      const key = `${row.idempotency_key}:email:${nativeSpec.number}`;
      await env.DB.prepare(
        `INSERT OR IGNORE INTO automation_tracking (
           idempotency_key, flow, email_number, entity_type, entity_id, recipient_hash,
           template_alias, status, scheduled_at, utm_campaign, utm_content, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'SCHEDULED', ?, ?, ?, ?, ?)`,
      ).bind(
        key,
        dispatchable.flow,
        nativeSpec.number,
        row.entity_type,
        row.entity_id,
        recipientHash,
        alias,
        new Date(new Date(row.due_at).getTime() + nativeSpec.offsetMinutes * 60_000).toISOString(),
        `novahair_${dispatchable.flow}`,
        nativeSpec.content,
        now,
        now,
      ).run();
    }
    return;
  }
  const spec = emailSpec(dispatchable.flow, dispatchable.emailNumber);
  const recipientHash = await hashEmail(dispatchable.event.email, lifecycleConfig(env).hashKey);
  await env.DB.prepare(
    `INSERT INTO automation_tracking (
       idempotency_key, flow, email_number, entity_type, entity_id, recipient_hash, template_alias,
       status, scheduled_at, triggered_at, utm_campaign, utm_content, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'TRIGGERED', ?, ?, ?, ?, ?, ?)
     ON CONFLICT(idempotency_key) DO UPDATE SET
       status = 'TRIGGERED', triggered_at = excluded.triggered_at, updated_at = excluded.updated_at`,
  ).bind(
    row.idempotency_key,
    dispatchable.flow,
    dispatchable.emailNumber,
    row.entity_type,
    row.entity_id,
    recipientHash,
    dispatchable.templateAlias,
    row.due_at,
    now,
    `novahair_${dispatchable.flow}`,
    spec.content,
    now,
    now,
  ).run();
}

async function afterSuccessfulDispatch(
  env: LifecycleEnv,
  row: ScheduledLifecycleRow,
  dispatchable: Dispatchable,
  now: string,
): Promise<void> {
  if (row.entity_type === "checkout" && row.event_name === "shopify.checkout_abandoned") {
    const final = row.email_number >= FLOW_SPECS.abandoned_checkout.emails.length;
    await env.DB.prepare(
      `UPDATE abandoned_checkouts
       SET automation_triggered_at = COALESCE(automation_triggered_at, ?),
           next_email_number = ?,
           next_due_at = ?,
           state = CASE WHEN ? THEN 'EXHAUSTED' ELSE state END,
           updated_record_at = ?
       WHERE shopify_checkout_id = ? AND state = 'ABANDONED'`,
    ).bind(
      now,
      row.email_number + 1,
      FLOW_SPECS.abandoned_checkout.emails[row.email_number]?.offsetMinutes
        ? new Date(new Date(row.due_at).getTime()
          + ((FLOW_SPECS.abandoned_checkout.emails[row.email_number]?.offsetMinutes ?? 0)
            - (FLOW_SPECS.abandoned_checkout.emails[row.email_number - 1]?.offsetMinutes ?? 0)) * 60_000).toISOString()
        : null,
      final ? 1 : 0,
      now,
      row.entity_id,
    ).run();
  } else if (row.entity_type === "checkout" && row.event_name === "shopify.checkout_recovered") {
    await env.DB.prepare(
      "UPDATE abandoned_checkouts SET recovery_event_sent_at = ?, updated_record_at = ? WHERE shopify_checkout_id = ?",
    ).bind(now, now, row.entity_id).run();
  } else if (row.entity_type === "order" && row.event_name === "shopify.post_purchase_started") {
    await env.DB.prepare(
      "UPDATE lifecycle_orders SET post_purchase_started_at = ?, updated_at = ? WHERE shopify_order_id = ?",
    ).bind(now, now, row.entity_id).run();
  }
  await recordAutomationTracking(env, row, dispatchable, now);
}

export async function dispatchDueLifecycleEvents(
  env: LifecycleEnv,
  now = new Date(),
  owner = crypto.randomUUID(),
): Promise<{ leased: number; sent: number; cancelled: number; failed: number }> {
  const rows = await leaseDueSchedules(env.DB, now, owner, 25);
  let sent = 0;
  let cancelled = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const dispatchable = await buildDispatchable(env, row);
      if (!dispatchable) {
        await markScheduleCancelled(env.DB, row.idempotency_key, "entity_no_longer_eligible", isoNow(now));
        cancelled += 1;
        continue;
      }
      const result = await sendLifecycleEvent(env, {
        idempotencyKey: row.idempotency_key,
        entityType: row.entity_type,
        entityId: row.entity_id,
        event: dispatchable.event,
        now,
      });
      if (result.sent) {
        const current = isoNow(now);
        await afterSuccessfulDispatch(env, row, dispatchable, current);
        await markScheduleDispatched(env.DB, row.idempotency_key, current);
        sent += 1;
      } else if (result.status === "RETRY") {
        await markScheduleRetry(env.DB, row, "resend_retryable_response", now);
        failed += 1;
      } else {
        await markScheduleDead(env.DB, row.idempotency_key, `resend_${result.status.toLowerCase()}`, isoNow(now));
        failed += 1;
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : "dispatch_failed";
      if (code === "recipient_not_allowed_in_current_mode") {
        await markScheduleCancelled(env.DB, row.idempotency_key, code, isoNow(now));
        cancelled += 1;
      } else {
        await markScheduleRetry(env.DB, row, code, now);
        await noteDispatchFailure(env, "schedule_dispatch", error, row.idempotency_key, now);
        failed += 1;
      }
    }
  }
  const status = failed ? "DEGRADED" : "OK";
  await setHealth(
    env.DB,
    "lifecycle_dispatch_status",
    JSON.stringify({ leased: rows.length, sent, cancelled, failed }),
    status,
    isoNow(now),
  );
  return { leased: rows.length, sent, cancelled, failed };
}
