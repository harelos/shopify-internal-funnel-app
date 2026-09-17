import { createHmac, timingSafeEqual } from "node:crypto";

export type ShopifyIntegrationEventName =
  | "CART_CHECKOUT_STARTED"
  | "CHECKOUT_COMPLETED_OBSERVED"
  | "SHOPIFY_ORDER_PAID";

export interface ShopifyIntegrationEvent {
  source: "PIXEL" | "WEBHOOK";
  eventKey: string;
  name: ShopifyIntegrationEventName;
  shopDomain: string;
  occurredAt?: Date;
  visitorId?: string;
  funnelId?: string;
  stepId?: string;
  variantId?: string;
  checkoutToken?: string;
  orderGid?: string;
  currency?: string;
  grossAmount?: number;
  /** Deliberately reduced metadata; never the raw Shopify payload. */
  payload: Record<string, string | number | boolean>;
}

export type NormalizationResult<T> =
  | { accepted: true; value: T }
  | { accepted: false; reason: string };

export interface FunnelContext {
  shopDomain: string;
  visitorId?: string;
  funnelId?: string;
  stepId?: string;
  variantId?: string;
}

export interface ShopifyPixelEventInput {
  id?: unknown;
  name?: unknown;
  timestamp?: unknown;
  data?: unknown;
}

export interface PaidOrderWebhookInput {
  rawBody: string | Uint8Array;
  hmacSha256?: string;
  topic?: string;
  shopDomain?: string;
  expectedShopDomain: string;
  webhookSecret: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function nestedString(root: Record<string, unknown> | undefined, key: string): string | undefined {
  return stringValue(root?.[key]);
}

function dateValue(value: unknown): Date | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function normalizeDomain(value: string): string { return value.trim().toLowerCase().replace(/\/$/, ""); }

function checkoutToken(data: Record<string, unknown> | undefined, checkout: Record<string, unknown> | undefined): string | undefined {
  return nestedString(checkout, "token") ?? nestedString(data, "checkout_token");
}

function orderGid(data: Record<string, unknown> | undefined, order: Record<string, unknown> | undefined): string | undefined {
  const explicit = nestedString(order, "id") ?? nestedString(data, "admin_graphql_api_id");
  if (explicit?.startsWith("gid://shopify/Order/")) return explicit;
  return explicit ? `gid://shopify/Order/${explicit}` : undefined;
}

/**
 * Converts Shopify Web Pixel standard events to the app's minimal event contract.
 * Funnel-specific page/CTA events remain owned by the app-proxy client. This adapter
 * intentionally does not preserve the browser event's arbitrary data object.
 */
export function normalizeShopifyPixelEvent(input: ShopifyPixelEventInput, context: FunnelContext): NormalizationResult<ShopifyIntegrationEvent> {
  const id = stringValue(input.id);
  const name = stringValue(input.name);
  if (!id || !name) return { accepted: false, reason: "pixel_event_id_and_name_required" };

  const data = record(input.data);
  const checkout = record(data?.checkout);
  const order = record(data?.order);
  const token = checkoutToken(data, checkout);
  const normalizedName = name === "checkout_started"
    ? "CART_CHECKOUT_STARTED"
    : name === "checkout_completed"
      ? "CHECKOUT_COMPLETED_OBSERVED"
      : undefined;

  if (!normalizedName) return { accepted: false, reason: "pixel_event_not_used_for_funnel_reporting" };

  const event: ShopifyIntegrationEvent = {
    source: "PIXEL",
    eventKey: `shopify:pixel:${id}`,
    name: normalizedName,
    shopDomain: context.shopDomain,
    occurredAt: dateValue(input.timestamp),
    visitorId: context.visitorId,
    funnelId: context.funnelId,
    stepId: context.stepId,
    variantId: context.variantId,
    checkoutToken: token,
    orderGid: normalizedName === "CHECKOUT_COMPLETED_OBSERVED" ? orderGid(data, order) : undefined,
    payload: {
      platformEventName: name,
      hasCheckoutToken: Boolean(token),
      hasOrderId: Boolean(orderGid(data, order)),
    },
  };
  return { accepted: true, value: event };
}

function rawBodyBuffer(rawBody: string | Uint8Array): Buffer { return typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : Buffer.from(rawBody); }

/** Verifies Shopify's base64 HMAC without logging or returning secret material. */
export function verifyShopifyWebhookHmac(rawBody: string | Uint8Array, suppliedHmac: string | undefined, webhookSecret: string): boolean {
  if (!suppliedHmac || !webhookSecret) return false;
  const expected = createHmac("sha256", webhookSecret).update(rawBodyBuffer(rawBody)).digest();
  let supplied: Buffer;
  try { supplied = Buffer.from(suppliedHmac, "base64"); } catch { return false; }
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function moneyValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Number(value.toFixed(2));
  if (typeof value === "string" && value.trim()) {
    const amount = Number(value);
    return Number.isFinite(amount) && amount >= 0 ? Number(amount.toFixed(2)) : undefined;
  }
  const money = record(value);
  const shopMoney = record(money?.shop_money) ?? record(money?.presentment_money);
  return moneyValue(shopMoney?.amount ?? money?.amount);
}

function orderCurrency(payload: Record<string, unknown>): string | undefined {
  const nested = record(record(payload.current_total_price_set)?.shop_money)?.currency_code;
  const currency = stringValue(payload.presentment_currency) ?? stringValue(payload.currency) ?? stringValue(nested);
  return currency?.toUpperCase();
}

function orderIdentifier(payload: Record<string, unknown>): string | undefined {
  const explicit = stringValue(payload.admin_graphql_api_id);
  if (explicit?.startsWith("gid://shopify/Order/")) return explicit;
  const numericId = stringValue(payload.id);
  return numericId ? `gid://shopify/Order/${numericId}` : undefined;
}

/**
 * Validates and reduces an orders/paid webhook. It is an offline adapter only;
 * the future HTTP route must pass the exact raw request bytes and headers here.
 */
export function normalizePaidOrderWebhook(input: PaidOrderWebhookInput): NormalizationResult<ShopifyIntegrationEvent> {
  if (!verifyShopifyWebhookHmac(input.rawBody, input.hmacSha256, input.webhookSecret)) return { accepted: false, reason: "invalid_webhook_hmac" };
  if (input.topic?.toLowerCase() !== "orders/paid") return { accepted: false, reason: "unsupported_webhook_topic" };
  if (!input.shopDomain || normalizeDomain(input.shopDomain) !== normalizeDomain(input.expectedShopDomain)) return { accepted: false, reason: "shop_domain_not_allowlisted" };

  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(typeof input.rawBody === "string" ? input.rawBody : Buffer.from(input.rawBody).toString("utf8"));
    const parsedRecord = record(parsed);
    if (!parsedRecord) return { accepted: false, reason: "webhook_json_object_required" };
    payload = parsedRecord;
  } catch { return { accepted: false, reason: "webhook_json_invalid" }; }

  const gid = orderIdentifier(payload);
  const amount = moneyValue(payload.current_total_price ?? payload.total_price ?? record(payload.current_total_price_set));
  const currency = orderCurrency(payload);
  if (!gid || amount === undefined || !currency) return { accepted: false, reason: "paid_order_identity_amount_currency_required" };

  const token = stringValue(payload.checkout_token);
  return {
    accepted: true,
    value: {
      source: "WEBHOOK",
      eventKey: `shopify:webhook:orders/paid:${gid}`,
      name: "SHOPIFY_ORDER_PAID",
      shopDomain: normalizeDomain(input.shopDomain),
      occurredAt: dateValue(payload.processed_at) ?? dateValue(payload.created_at),
      checkoutToken: token,
      orderGid: gid,
      currency,
      grossAmount: amount,
      payload: {
        topic: "orders/paid",
        hasCheckoutToken: Boolean(token),
      },
    },
  };
}
