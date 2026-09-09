import { lifecycleConfig, lifecycleMode } from "./config";
import { hashEmail, hashPayload, verifyShopifyHmac, verifySvixSignature } from "./crypto";
import {
  cancelEntitySchedules,
  incrementUsageOnce,
  isoNow,
  recordLifecycleError,
  scheduleLifecycleEvent,
  setHealth,
} from "./db";
import { dueAt, FLOW_SPECS, replenishmentOffsetDays } from "./flow-specs";
import { monitorResendQuota } from "./quota";
import type {
  ConsentState,
  LifecycleEnv,
  ResendWebhookPayload,
  ShopifyFulfillmentEventWebhook,
  ShopifyFulfillmentWebhook,
  ShopifyOrderWebhook,
} from "./types";

function normalizedEmail(value: string | null | undefined): string | null {
  const email = value?.trim().toLowerCase() ?? "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function text(value: unknown, max = 255): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function orderId(payload: ShopifyOrderWebhook): string | null {
  const gid = text(payload.admin_graphql_api_id);
  if (gid?.startsWith("gid://shopify/Order/")) return gid;
  const id = payload.id === undefined ? null : String(payload.id);
  return id ? `gid://shopify/Order/${id}` : null;
}

function shopifyGid(resource: "Order" | "Fulfillment", value: unknown): string | null {
  const raw = value === null || value === undefined ? "" : String(value).trim();
  if (!raw) return null;
  return raw.startsWith(`gid://shopify/${resource}/`) ? raw : `gid://shopify/${resource}/${raw}`;
}

function fulfillmentStatus(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase().replaceAll("-", "_").replaceAll(" ", "_") ?? "";
  const allowed = new Set([
    "ATTEMPTED_DELIVERY",
    "CARRIER_PICKED_UP",
    "CONFIRMED",
    "DELAYED",
    "DELIVERED",
    "FAILURE",
    "IN_TRANSIT",
    "LABEL_PRINTED",
    "LABEL_PURCHASED",
    "OUT_FOR_DELIVERY",
    "READY_FOR_PICKUP",
  ]);
  return allowed.has(normalized) ? normalized : null;
}

function checkoutId(payload: ShopifyOrderWebhook): string | null {
  const id = payload.checkout_id === null || payload.checkout_id === undefined
    ? null
    : String(payload.checkout_id);
  return id ? `gid://shopify/AbandonedCheckout/${id}` : null;
}

function customerId(payload: ShopifyOrderWebhook): string | null {
  const gid = text(payload.customer?.admin_graphql_api_id);
  if (gid?.startsWith("gid://shopify/Customer/")) return gid;
  const id = payload.customer?.id === undefined ? null : String(payload.customer.id);
  return id ? `gid://shopify/Customer/${id}` : null;
}

function money(value: string | number | null | undefined): number | null {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? Number(amount.toFixed(2)) : null;
}

function orderMerchandise(payload: ShopifyOrderWebhook): {
  productName: string | null;
  shade: string | null;
  bundle: string | null;
  quantity: number;
  purchasedProductIds: string[];
  purchasedProductHandles: string[];
} {
  const items = payload.line_items ?? [];
  const first = items.find(item => /novahair|novasale|cjyd223160/i.test(
    [item.title, item.sku, item.product_handle].filter(Boolean).join(" "),
  )) ?? items[0];
  const label = [first?.variant_title, first?.title, first?.sku].filter(Boolean).join(" ");
  const units = label.match(/(\d+)\s*(?:בקבוקים|בקבוק|bottles?|pack)/i);
  const shade = label.match(/(?:\/|גוון|shade)\s*[:\-]?\s*([^|,/]+)/i);
  const lineQuantity = Math.max(0, Number(first?.quantity) || 0);
  const bundleUnits = Math.max(1, Number(units?.[1]) || lineQuantity || 1);
  const purchasedProductIds = [...new Set(items.flatMap((item) => {
    const raw = item.product_id === null || item.product_id === undefined ? "" : String(item.product_id).trim();
    if (!raw) return [];
    return [raw.startsWith("gid://shopify/Product/") ? raw : `gid://shopify/Product/${raw}`];
  }))];
  const purchasedProductHandles = [...new Set(items.flatMap((item) => {
    const handle = item.product_handle?.trim().toLowerCase();
    return handle ? [handle] : [];
  }))];
  return {
    productName: text(first?.title) ?? null,
    shade: shade?.[1]?.trim() ?? text(first?.variant_title) ?? null,
    bundle: units?.[1] ? `${units[1]} bottles` : text(first?.variant_title) ?? null,
    quantity: bundleUnits,
    purchasedProductIds,
    purchasedProductHandles,
  };
}

async function consentForEmail(
  env: LifecycleEnv,
  emailHash: string,
  exactCheckoutId: string | null,
): Promise<ConsentState> {
  if (exactCheckoutId) {
    const checkout = await env.DB.prepare(
      "SELECT consent_state FROM abandoned_checkouts WHERE shopify_checkout_id = ?",
    ).bind(exactCheckoutId).first<{ consent_state: ConsentState }>();
    if (checkout?.consent_state) return checkout.consent_state;
  }
  const identity = await env.DB.prepare(
    "SELECT consent_state FROM lifecycle_identity_links WHERE email_hash = ?",
  ).bind(emailHash).first<{ consent_state: ConsentState }>();
  return identity?.consent_state ?? "UNKNOWN";
}

async function purchaseGlobalStop(
  env: LifecycleEnv,
  emailHash: string,
  orderGid: string,
  completedAt: string,
): Promise<void> {
  const checkouts = await env.DB.prepare(
    `SELECT shopify_checkout_id FROM abandoned_checkouts
     WHERE email_hash = ? AND state IN ('PENDING', 'ABANDONED', 'INELIGIBLE')`,
  ).bind(emailHash).all<{ shopify_checkout_id: string }>();
  for (const checkout of checkouts.results ?? []) {
    await cancelEntitySchedules(env.DB, "checkout", checkout.shopify_checkout_id, completedAt);
  }
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE abandoned_checkouts
       SET state = 'PURCHASED', purchase_event_sent_at = COALESCE(purchase_event_sent_at, ?),
           updated_record_at = ?
       WHERE email_hash = ? AND state IN ('PENDING', 'ABANDONED', 'INELIGIBLE')`,
    ).bind(completedAt, completedAt, emailHash),
    env.DB.prepare(
      `UPDATE lifecycle_identity_links
       SET lifecycle_stage = 'POST_PURCHASE', last_order_id = ?, last_order_at = ?, updated_at = ?
       WHERE email_hash = ?`,
    ).bind(orderGid, completedAt, completedAt, emailHash),
  ]);
}

export interface FulfillmentObservation {
  eventKey: string;
  shopifyOrderId: string;
  shopifyFulfillmentId?: string | null;
  status?: string | null;
  happenedAt: string;
  trackingCompany?: string | null;
  trackingNumber?: string | null;
  estimatedDeliveryAt?: string | null;
  source: "WEBHOOK" | "POLL";
  payload: unknown;
}

export async function processFulfillmentObservation(
  env: LifecycleEnv,
  observation: FulfillmentObservation,
  now = new Date(),
): Promise<{ processed: boolean; duplicate?: boolean; delivered?: boolean }> {
  const current = isoNow(now);
  const order = await env.DB.prepare(
    `SELECT shopify_order_id, consent_state, delivered_at
     FROM lifecycle_orders WHERE shopify_order_id = ?`,
  ).bind(observation.shopifyOrderId).first<{
    shopify_order_id: string;
    consent_state: ConsentState;
    delivered_at: string | null;
  }>();
  if (!order) return { processed: false };

  const duplicate = await env.DB.prepare(
    "SELECT event_key FROM shopify_fulfillment_events WHERE event_key = ?",
  ).bind(observation.eventKey).first<{ event_key: string }>();
  const wasDuplicate = Boolean(duplicate);

  const status = fulfillmentStatus(observation.status);
  const happenedAt = text(observation.happenedAt) ?? current;
  const trackingNumberHash = observation.trackingNumber
    ? await hashPayload(observation.trackingNumber)
    : null;
  const deliveredAt = status === "DELIVERED" ? happenedAt : null;
  const inTransitAt = ["CARRIER_PICKED_UP", "IN_TRANSIT"].includes(status ?? "") ? happenedAt : null;
  const readyForPickupAt = status === "READY_FOR_PICKUP" ? happenedAt : null;
  const outForDeliveryAt = status === "OUT_FOR_DELIVERY" ? happenedAt : null;

  if (!wasDuplicate) {
    await env.DB.prepare(
      `INSERT INTO shopify_fulfillment_events
        (event_key, shopify_fulfillment_id, shopify_order_id, status, happened_at,
         source, payload_hash, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      observation.eventKey,
      observation.shopifyFulfillmentId ?? null,
      observation.shopifyOrderId,
      status,
      happenedAt,
      observation.source,
      await hashPayload(observation.payload),
      current,
    ).run();
  }

  await env.DB.prepare(
    `UPDATE lifecycle_orders SET
       tracking_status = CASE
         WHEN tracking_status = 'DELIVERED' THEN tracking_status
         WHEN ? IS NOT NULL AND (fulfillment_updated_at IS NULL OR ? >= fulfillment_updated_at) THEN ?
         ELSE tracking_status
       END,
       tracking_company = COALESCE(?, tracking_company),
       tracking_number_hash = COALESCE(?, tracking_number_hash),
       tracking_available_at = CASE
         WHEN ? IS NOT NULL THEN COALESCE(tracking_available_at, ?)
         ELSE tracking_available_at
       END,
       in_transit_at = COALESCE(in_transit_at, ?),
       ready_for_pickup_at = COALESCE(ready_for_pickup_at, ?),
       out_for_delivery_at = COALESCE(out_for_delivery_at, ?),
       delivered_at = COALESCE(delivered_at, ?),
       estimated_delivery_at = COALESCE(?, estimated_delivery_at),
       fulfillment_updated_at = ?,
       updated_at = ?
     WHERE shopify_order_id = ?`,
  ).bind(
    status,
    happenedAt,
    status,
    text(observation.trackingCompany),
    trackingNumberHash,
    trackingNumberHash,
    happenedAt,
    inTransitAt,
    readyForPickupAt,
    outForDeliveryAt,
    deliveredAt,
    text(observation.estimatedDeliveryAt),
    happenedAt,
    current,
    observation.shopifyOrderId,
  ).run();

  // Re-run this idempotent reconciliation for duplicate deliveries too. If a prior
  // attempt failed after recording the receipt, a webhook retry must repair every
  // missing schedule instead of treating the receipt as fully processed.
  if (deliveredAt && order.consent_state === "SUBSCRIBED") {
    for (const spec of FLOW_SPECS.post_purchase.emails.filter(email => email.anchor === "delivered")) {
      await scheduleLifecycleEvent(env.DB, {
        idempotencyKey: `order:${observation.shopifyOrderId}:post_purchase:email:${spec.number}`,
        eventName: "shopify.post_purchase_started",
        flow: "post_purchase",
        emailNumber: spec.number,
        entityType: "order",
        entityId: observation.shopifyOrderId,
        dueAt: dueAt(deliveredAt, spec.offsetMinutes),
        now: current,
      });
    }
    await env.DB.prepare(
      `UPDATE lifecycle_orders
       SET post_purchase_delivery_scheduled_at = COALESCE(post_purchase_delivery_scheduled_at, ?),
           updated_at = ?
       WHERE shopify_order_id = ?`,
    ).bind(current, current, observation.shopifyOrderId).run();
  }

  await env.DB.prepare(
    "UPDATE shopify_fulfillment_events SET processed_at = ? WHERE event_key = ?",
  ).bind(current, observation.eventKey).run();
  await setHealth(env.DB, "last_shopify_fulfillment_event", current, "OK", current);
  return {
    processed: true,
    ...(wasDuplicate ? { duplicate: true } : {}),
    delivered: Boolean(deliveredAt || order.delivered_at),
  };
}

export async function processPaidOrder(
  env: LifecycleEnv,
  payload: ShopifyOrderWebhook,
  eventId: string,
  now: Date,
): Promise<void> {
  const config = lifecycleConfig(env);
  const gid = orderId(payload);
  const email = normalizedEmail(payload.contact_email ?? payload.email ?? payload.customer?.email);
  if (!gid || !email) throw new Error("order_identity_unavailable");
  const current = isoNow(now);
  const completedAt = text(payload.processed_at) ?? text(payload.created_at) ?? current;
  const exactCheckoutId = checkoutId(payload);
  const emailHash = await hashEmail(email, config.hashKey);
  const suppliedConsent = payload.marketing_consent_state;
  const consentState = suppliedConsent && [
    "SUBSCRIBED", "PENDING", "NOT_SUBSCRIBED", "UNSUBSCRIBED", "REDACTED", "UNKNOWN",
  ].includes(suppliedConsent)
    ? suppliedConsent
    : await consentForEmail(env, emailHash, exactCheckoutId);
  const merchandise = orderMerchandise(payload);
  const existing = await env.DB.prepare(
    "SELECT shopify_order_id FROM lifecycle_orders WHERE email_hash = ? AND shopify_order_id <> ? LIMIT 1",
  ).bind(emailHash, gid).first<{ shopify_order_id: string }>();
  const repeatPurchase = Boolean(existing);
  const replenishmentDueAt = new Date(
    new Date(completedAt).getTime()
      + replenishmentOffsetDays(merchandise.bundle, merchandise.quantity) * 86_400_000,
  ).toISOString();

  await env.DB.prepare(
    `INSERT INTO lifecycle_orders (
       shopify_order_id, shopify_checkout_id, shopify_customer_id, email, email_hash,
       first_name, consent_state, completed_at, bundle, quantity, shade, product_name,
       purchased_product_ids_json, purchased_product_handles_json, total, currency,
       replenishment_due_at, repeat_purchase, payload_hash, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(shopify_order_id) DO UPDATE SET
       shopify_checkout_id = excluded.shopify_checkout_id,
       shopify_customer_id = excluded.shopify_customer_id,
       email = excluded.email,
       email_hash = excluded.email_hash,
       first_name = excluded.first_name,
       consent_state = excluded.consent_state,
       completed_at = excluded.completed_at,
       bundle = excluded.bundle,
       quantity = excluded.quantity,
       shade = excluded.shade,
       product_name = excluded.product_name,
       purchased_product_ids_json = excluded.purchased_product_ids_json,
       purchased_product_handles_json = excluded.purchased_product_handles_json,
       total = excluded.total,
       currency = excluded.currency,
       replenishment_due_at = excluded.replenishment_due_at,
       repeat_purchase = excluded.repeat_purchase,
       payload_hash = excluded.payload_hash,
       updated_at = excluded.updated_at`,
  ).bind(
    gid,
    exactCheckoutId,
    customerId(payload),
    email,
    emailHash,
    text(payload.customer?.first_name),
    consentState,
    completedAt,
    merchandise.bundle,
    merchandise.quantity,
    merchandise.shade,
    merchandise.productName,
    JSON.stringify(merchandise.purchasedProductIds),
    JSON.stringify(merchandise.purchasedProductHandles),
    money(payload.current_total_price ?? payload.total_price),
    text(payload.presentment_currency ?? payload.currency)?.toUpperCase(),
    replenishmentDueAt,
    repeatPurchase ? 1 : 0,
    await hashPayload(payload),
    current,
    current,
  ).run();

  await purchaseGlobalStop(env, emailHash, gid, completedAt);

  const immediateEvents = [
    { eventName: "shopify.purchase_completed", flow: "post_purchase" },
    { eventName: "lifecycle.browse_stop", flow: "browse_abandonment" },
    { eventName: "lifecycle.cart_stop", flow: "abandoned_cart" },
    { eventName: "lifecycle.replenishment_stop", flow: "replenishment" },
  ] as const;
  for (const item of immediateEvents) {
    await scheduleLifecycleEvent(env.DB, {
      idempotencyKey: `order:${gid}:${item.eventName}`,
      eventName: item.eventName,
      flow: item.flow,
      emailNumber: 0,
      entityType: "order",
      entityId: gid,
      dueAt: current,
      now: current,
    });
  }

  if (consentState === "SUBSCRIBED") {
    for (const spec of FLOW_SPECS.post_purchase.emails.filter(email => email.anchor === "purchase")) {
      await scheduleLifecycleEvent(env.DB, {
        idempotencyKey: `order:${gid}:post_purchase:email:${spec.number}`,
        eventName: "shopify.post_purchase_started",
        flow: "post_purchase",
        emailNumber: spec.number,
        entityType: "order",
        entityId: gid,
        dueAt: dueAt(completedAt, spec.offsetMinutes),
        now: current,
      });
    }
    await scheduleLifecycleEvent(env.DB, {
      idempotencyKey: `order:${gid}:replenishment_due`,
      eventName: "shopify.replenishment_due",
      flow: "replenishment",
      emailNumber: 0,
      entityType: "order",
      entityId: gid,
      dueAt: replenishmentDueAt,
      now: current,
    });
  }
  await setHealth(env.DB, "last_shopify_purchase", current, "OK", current);
  await env.DB.prepare(
    `UPDATE shopify_event_receipts
     SET status = 'PROCESSED', processed_at = ?, error_code = NULL WHERE event_id = ?`,
  ).bind(current, eventId).run();
}

export async function processShopifyLifecycleWebhook(
  env: LifecycleEnv,
  request: Request,
  now = new Date(),
): Promise<{ accepted: boolean; duplicate?: boolean; ignored?: boolean }> {
  const config = lifecycleConfig(env);
  const rawBody = await request.text();
  const suppliedHmac = request.headers.get("x-shopify-hmac-sha256") ?? "";
  const topic = (request.headers.get("x-shopify-topic") ?? "").toLowerCase();
  const shopDomain = (request.headers.get("x-shopify-shop-domain") ?? "").toLowerCase();
  const eventId = request.headers.get("x-shopify-webhook-id") ?? "";
  if (
    request.method !== "POST"
    || !eventId
    || shopDomain !== config.shopDomain
    || !await verifyShopifyHmac(rawBody, suppliedHmac, config.shopifyWebhookSecret)
  ) {
    throw new Error("invalid_shopify_webhook");
  }

  const existing = await env.DB.prepare(
    "SELECT status FROM shopify_event_receipts WHERE event_id = ?",
  ).bind(eventId).first<{ status: string }>();
  if (existing?.status === "PROCESSED" || existing?.status === "IGNORED") {
    return { accepted: true, duplicate: true };
  }
  const current = isoNow(now);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO shopify_event_receipts
      (event_id, topic, shop_domain, payload_hash, received_at, status)
     VALUES (?, ?, ?, ?, ?, 'RECEIVED')`,
  ).bind(eventId, topic, shopDomain, await hashPayload(rawBody), current).run();

  try {
    const parsed = JSON.parse(rawBody) as ShopifyOrderWebhook & ShopifyFulfillmentEventWebhook & ShopifyFulfillmentWebhook;
    const fulfillmentEventTopic = topic === "fulfillment_events/create";
    const fulfillmentTopic = topic === "fulfillments/create" || topic === "fulfillments/update";
    if (fulfillmentEventTopic || fulfillmentTopic) {
      const gid = shopifyGid("Order", parsed.order_id);
      const fulfillmentGid = shopifyGid("Fulfillment", parsed.fulfillment_id ?? parsed.id);
      if (!gid) {
        await env.DB.prepare(
          "UPDATE shopify_event_receipts SET status = 'IGNORED', processed_at = ? WHERE event_id = ?",
        ).bind(current, eventId).run();
        return { accepted: true, ignored: true };
      }
      const happenedAt = text(
        fulfillmentEventTopic
          ? parsed.happened_at ?? parsed.updated_at ?? parsed.created_at
          : parsed.updated_at ?? parsed.created_at,
      ) ?? current;
      const trackingNumber = fulfillmentTopic
        ? text(parsed.tracking_number ?? parsed.tracking_numbers?.[0])
        : null;
      const result = await processFulfillmentObservation(env, {
        eventKey: `shopify-webhook:${eventId}`,
        shopifyOrderId: gid,
        shopifyFulfillmentId: fulfillmentGid,
        status: (fulfillmentEventTopic ? parsed.status : parsed.shipment_status) ?? null,
        happenedAt,
        trackingCompany: fulfillmentTopic ? parsed.tracking_company ?? null : null,
        trackingNumber,
        estimatedDeliveryAt: fulfillmentEventTopic ? parsed.estimated_delivery_at ?? null : null,
        source: "WEBHOOK",
        payload: parsed,
      }, now);
      await env.DB.prepare(
        `UPDATE shopify_event_receipts SET status = ?, processed_at = ?, error_code = NULL
         WHERE event_id = ?`,
      ).bind(result.processed ? "PROCESSED" : "IGNORED", current, eventId).run();
      return result.processed ? { accepted: true } : { accepted: true, ignored: true };
    }

    const payload = parsed as ShopifyOrderWebhook;
    const paidTopic = topic === "orders/paid";
    const paidCreate = topic === "orders/create"
      && ["paid", "partially_paid"].includes((payload.financial_status ?? "").toLowerCase());
    if (!paidTopic && !paidCreate) {
      await env.DB.prepare(
        "UPDATE shopify_event_receipts SET status = 'IGNORED', processed_at = ? WHERE event_id = ?",
      ).bind(current, eventId).run();
      return { accepted: true, ignored: true };
    }
    if (payload.test && lifecycleMode(env) === "production") {
      await env.DB.prepare(
        "UPDATE shopify_event_receipts SET status = 'IGNORED', processed_at = ? WHERE event_id = ?",
      ).bind(current, eventId).run();
      return { accepted: true, ignored: true };
    }
    const recipient = normalizedEmail(payload.contact_email ?? payload.email ?? payload.customer?.email);
    const occurredAt = text(payload.processed_at) ?? text(payload.created_at) ?? current;
    const occurredTime = new Date(occurredAt).getTime();
    const activationTime = new Date(config.activatedAt).getTime();
    if (
      (lifecycleMode(env) === "test" && recipient !== config.testEmail)
      || !Number.isFinite(occurredTime)
      || !Number.isFinite(activationTime)
      || occurredTime < activationTime
    ) {
      await env.DB.prepare(
        "UPDATE shopify_event_receipts SET status = 'IGNORED', processed_at = ? WHERE event_id = ?",
      ).bind(current, eventId).run();
      return { accepted: true, ignored: true };
    }
    await processPaidOrder(env, payload, eventId, now);
    return { accepted: true };
  } catch (error) {
    const code = error instanceof Error ? error.message : "shopify_webhook_processing_failed";
    await env.DB.prepare(
      "UPDATE shopify_event_receipts SET status = 'FAILED', error_code = ? WHERE event_id = ?",
    ).bind(code.slice(0, 100), eventId).run();
    await recordLifecycleError(env.DB, {
      component: "shopify_webhook",
      code,
      safeMessage: "A verified Shopify webhook could not be processed for lifecycle state.",
      contextHash: await hashPayload(eventId),
      retryable: true,
      now: current,
    });
    throw error;
  }
}

export async function processMarketingCapture(
  env: LifecycleEnv,
  request: Request,
  now = new Date(),
): Promise<{ scheduled: boolean }> {
  const body = await request.json() as Record<string, unknown>;
  const email = normalizedEmail(typeof body.email === "string" ? body.email : null);
  if (!email || body.marketingConsent !== true) return { scheduled: false };
  const config = lifecycleConfig(env);
  const current = isoNow(now);
  const emailHash = await hashEmail(email, config.hashKey);
  const identityId = `identity:${emailHash}`;
  const visitor = text(body.visitorId, 300);
  const visitorHash = visitor ? await hashPayload(visitor) : null;
  const firstName = text(body.firstName ?? body.first_name, 100);
  await env.DB.prepare(
    `INSERT INTO lifecycle_identity_links (
       identity_id, email, email_hash, first_name, visitor_hash, consent_state,
       consent_updated_at, identity_source, verified_at, lifecycle_stage, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 'SUBSCRIBED', ?, 'SHOPIFY_POPUP', ?, 'WELCOME', ?, ?)
     ON CONFLICT(email_hash) DO UPDATE SET
       email = excluded.email,
       first_name = COALESCE(excluded.first_name, lifecycle_identity_links.first_name),
       visitor_hash = COALESCE(excluded.visitor_hash, lifecycle_identity_links.visitor_hash),
       consent_state = 'SUBSCRIBED',
       consent_updated_at = excluded.consent_updated_at,
       verified_at = excluded.verified_at,
       updated_at = excluded.updated_at`,
  ).bind(identityId, email, emailHash, firstName, visitorHash, current, current, current, current).run();

  const purchase = await env.DB.prepare(
    "SELECT shopify_order_id FROM lifecycle_orders WHERE email_hash = ? LIMIT 1",
  ).bind(emailHash).first<{ shopify_order_id: string }>();
  if (purchase) return { scheduled: false };
  await scheduleLifecycleEvent(env.DB, {
    idempotencyKey: `welcome:${identityId}`,
    eventName: "shopify.marketing_subscribed",
    flow: "welcome",
    emailNumber: 0,
    entityType: "identity",
    entityId: identityId,
    dueAt: current,
    now: current,
  });
  return { scheduled: true };
}

function trackingStatus(eventType: string): string | null {
  const map: Record<string, string> = {
    "email.sent": "SENT",
    "email.delivered": "DELIVERED",
    "email.opened": "OPENED",
    "email.clicked": "CLICKED",
    "email.failed": "FAILED",
    "email.bounced": "FAILED",
    "email.complained": "SUPPRESSED",
    "email.suppressed": "SUPPRESSED",
  };
  return map[eventType] ?? null;
}

async function applySuppression(
  env: LifecycleEnv,
  emailHash: string,
  payload: ResendWebhookPayload,
  now: string,
): Promise<void> {
  const reason = payload.type.replace(/^email\./, "");
  await env.DB.prepare(
    `INSERT INTO suppressions
      (email_hash, source, reason, occurred_at, resend_email_id, active, created_at, updated_at)
     VALUES (?, 'RESEND_WEBHOOK', ?, ?, ?, 1, ?, ?)
     ON CONFLICT(email_hash) DO UPDATE SET
       source = excluded.source, reason = excluded.reason, occurred_at = excluded.occurred_at,
       resend_email_id = excluded.resend_email_id, active = 1, updated_at = excluded.updated_at`,
  ).bind(emailHash, reason, payload.created_at, payload.data.email_id ?? null, now, now).run();
  const checkouts = await env.DB.prepare(
    "SELECT shopify_checkout_id FROM abandoned_checkouts WHERE email_hash = ? AND state = 'ABANDONED'",
  ).bind(emailHash).all<{ shopify_checkout_id: string }>();
  for (const checkout of checkouts.results ?? []) {
    await cancelEntitySchedules(env.DB, "checkout", checkout.shopify_checkout_id, now);
  }
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE abandoned_checkouts SET state = 'SUPPRESSED', updated_record_at = ?
       WHERE email_hash = ? AND state IN ('PENDING', 'ABANDONED', 'INELIGIBLE')`,
    ).bind(now, emailHash),
    env.DB.prepare(
      "UPDATE lifecycle_identity_links SET lifecycle_stage = 'SUPPRESSED', updated_at = ? WHERE email_hash = ?",
    ).bind(now, emailHash),
  ]);
}

export async function handleResendWebhook(env: LifecycleEnv, request: Request, now = new Date()): Promise<Response> {
  const config = lifecycleConfig(env);
  const rawBody = await request.text();
  const eventId = request.headers.get("svix-id") ?? "";
  const timestamp = request.headers.get("svix-timestamp") ?? "";
  const signature = request.headers.get("svix-signature") ?? "";
  const verified = await verifySvixSignature({
    rawBody,
    id: eventId,
    timestamp,
    signature,
    secret: config.resendWebhookSecret,
    now: now.getTime(),
  });
  if (!verified) return new Response("Invalid signature", { status: 400 });

  let payload: ResendWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as ResendWebhookPayload;
  } catch {
    return new Response("Invalid payload", { status: 400 });
  }
  const recipient = normalizedEmail(payload.data.to?.[0] ?? payload.data.email);
  const recipientHash = recipient ? await hashEmail(recipient, config.hashKey) : null;
  const current = isoNow(now);
  const existing = await env.DB.prepare(
    "SELECT status FROM email_delivery_events WHERE webhook_event_id = ?",
  ).bind(eventId).first<{ status: "RECEIVED" | "PROCESSING" | "PROCESSED" | "FAILED" }>();
  if (existing?.status === "PROCESSED") return Response.json({ ok: true, duplicate: true });
  if (existing?.status === "PROCESSING") return Response.json({ ok: true, duplicate: true, processing: true }, { status: 202 });

  await env.DB.prepare(
    `INSERT INTO email_delivery_events (
       webhook_event_id, event_type, resend_email_id, template_id, automation_id,
       recipient_hash, occurred_at, received_at, payload_hash, status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PROCESSING')
     ON CONFLICT(webhook_event_id) DO UPDATE SET
       event_type = excluded.event_type,
       resend_email_id = excluded.resend_email_id,
       template_id = excluded.template_id,
       automation_id = excluded.automation_id,
       recipient_hash = excluded.recipient_hash,
       occurred_at = excluded.occurred_at,
       received_at = excluded.received_at,
       payload_hash = excluded.payload_hash,
       status = 'PROCESSING',
       processed_at = NULL,
       error_code = NULL
     WHERE email_delivery_events.status = 'FAILED'`,
  ).bind(
    eventId,
    payload.type,
    payload.data.email_id ?? null,
    payload.data.template_id ?? null,
    payload.data.automation_id ?? null,
    recipientHash,
    payload.created_at,
    current,
    await hashPayload(payload),
  ).run();
  try {
    if (payload.type === "email.sent") {
      await incrementUsageOnce(env.DB, "emails_sent", payload.created_at, `resend-webhook:${eventId}`);
      await monitorResendQuota(env, now);
    }
    const status = trackingStatus(payload.type);
    if (status && recipientHash) {
      const template = payload.data.template_id
        ? await env.DB.prepare(
          "SELECT name FROM resend_resources WHERE resource_type = 'TEMPLATE' AND external_id = ?",
        ).bind(payload.data.template_id).first<{ name: string }>()
        : null;
      const candidate = await env.DB.prepare(
        `SELECT id FROM automation_tracking
         WHERE recipient_hash = ?
           AND (? IS NULL OR template_alias = ?)
           AND status IN ('SCHEDULED', 'TRIGGERED', 'SENT', 'DELIVERED', 'OPENED')
         ORDER BY COALESCE(triggered_at, scheduled_at, created_at) DESC
         LIMIT 1`,
      ).bind(recipientHash, template?.name ?? null, template?.name ?? null).first<{ id: number }>();
      if (candidate) {
        await env.DB.prepare(
          `UPDATE automation_tracking
           SET status = ?, resend_email_id = COALESCE(resend_email_id, ?),
               template_id = COALESCE(template_id, ?),
               automation_id = COALESCE(automation_id, ?),
               sent_at = CASE WHEN ? = 'SENT' THEN ? ELSE sent_at END,
               clicked_at = CASE WHEN ? = 'CLICKED' THEN ? ELSE clicked_at END,
               updated_at = ?
           WHERE id = ?`,
        ).bind(
          status,
          payload.data.email_id ?? null,
          payload.data.template_id ?? null,
          payload.data.automation_id ?? null,
          status,
          payload.created_at,
          status,
          payload.created_at,
          current,
          candidate.id,
        ).run();
      }
    }

    const hardBounce = payload.type === "email.bounced"
      && (payload.data.bounce?.type ?? "Permanent").toLowerCase() === "permanent";
    const contactUnsubscribed = payload.type === "contact.updated" && payload.data.unsubscribed === true;
    if (recipientHash && (hardBounce || contactUnsubscribed || ["email.complained", "email.suppressed"].includes(payload.type))) {
      await applySuppression(env, recipientHash, payload, current);
    }
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE email_delivery_events
         SET status = 'PROCESSED', processed_at = ?, error_code = NULL
         WHERE webhook_event_id = ?`,
      ).bind(current, eventId),
      env.DB.prepare(
        `INSERT INTO health_state (key, value, status, updated_at)
         VALUES ('last_resend_webhook', ?, 'OK', ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value, status = excluded.status, updated_at = excluded.updated_at`,
      ).bind(current, current),
    ]);
    return Response.json({ ok: true });
  } catch (error) {
    const code = error instanceof Error && /^[a-z0-9_:-]{1,100}$/i.test(error.message)
      ? error.message
      : "resend_webhook_processing_failed";
    await env.DB.prepare(
      `UPDATE email_delivery_events
       SET status = 'FAILED', processed_at = NULL, error_code = ?
       WHERE webhook_event_id = ?`,
    ).bind(code.slice(0, 100), eventId).run();
    await recordLifecycleError(env.DB, {
      component: "resend_webhook",
      code,
      safeMessage: "A verified Resend webhook could not be fully processed.",
      contextHash: await hashPayload(eventId),
      retryable: true,
      now: current,
    });
    return Response.json({ ok: false, error: "processing_failed" }, { status: 500 });
  }
}
