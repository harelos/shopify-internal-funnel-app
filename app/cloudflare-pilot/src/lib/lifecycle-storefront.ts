import { createHash } from "node:crypto";
import { env as cloudflareEnv } from "cloudflare:workers";

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<unknown>;
}

interface D1Like {
  prepare(sql: string): D1Statement;
}

function database(): D1Like {
  const runtime = (cloudflareEnv as { DB?: D1Like } | undefined)
    ?? (globalThis as typeof globalThis & { __SHOPIFY_WORKER_ENV__?: { DB?: D1Like } }).__SHOPIFY_WORKER_ENV__;
  if (!runtime?.DB) throw new Error("Cloudflare D1 binding is unavailable.");
  return runtime.DB;
}

export function lifecycleVisitorHash(visitorId: string): string {
  return createHash("sha256").update(visitorId.trim()).digest("hex");
}

function clean(value: string | undefined, max: number): string | null {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, max) : null;
}

export async function enqueueLifecycleIdentityClaim(input: {
  claimId: string;
  visitorId: string;
  shopifyCustomerId?: string;
  email?: string;
  firstName?: string;
  consentState: "SUBSCRIBED" | "NOT_SUBSCRIBED" | "UNKNOWN";
  source: string;
  occurredAt?: Date;
}): Promise<void> {
  if (!input.visitorId.trim()) return;
  const now = (input.occurredAt ?? new Date()).toISOString();
  await database().prepare(
    `INSERT OR IGNORE INTO lifecycle_identity_claims
      (claim_id, shopify_customer_id, email, first_name, visitor_hash, consent_state,
       source, occurred_at, next_attempt_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    input.claimId.slice(0, 240),
    clean(input.shopifyCustomerId, 160),
    clean(input.email?.toLowerCase(), 254),
    clean(input.firstName, 100),
    lifecycleVisitorHash(input.visitorId),
    input.consentState,
    input.source.slice(0, 80),
    now,
    now,
    now,
  ).run();
}

export async function recordStorefrontLifecycleEvent(input: {
  eventId: string;
  eventName: "product_viewed" | "product_added_to_cart" | "product_removed_from_cart" | "cart_viewed" | "checkout_started" | "checkout_completed";
  visitorId?: string;
  shopifyCustomerId?: string;
  occurredAt?: Date;
  productHandle?: string;
  productName?: string;
  productImage?: string;
  variantId?: string;
  variantName?: string;
  quantity?: number;
  cartId?: string;
  checkoutId?: string;
}): Promise<boolean> {
  const visitorId = input.visitorId?.trim();
  if (!visitorId) return false;
  const occurredAt = (input.occurredAt ?? new Date()).toISOString();
  const payloadHash = createHash("sha256").update(JSON.stringify({
    eventName: input.eventName,
    visitorId,
    shopifyCustomerId: input.shopifyCustomerId,
    productHandle: input.productHandle,
    variantId: input.variantId,
    quantity: input.quantity,
    cartId: input.cartId,
    checkoutId: input.checkoutId,
    occurredAt,
  })).digest("hex");
  await database().prepare(
    `INSERT OR IGNORE INTO storefront_lifecycle_events
      (event_id, visitor_hash, shopify_customer_id, event_name, occurred_at,
       product_handle, product_name, product_image, variant_id, variant_name,
       quantity, cart_id, checkout_id, payload_hash, next_attempt_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    input.eventId.slice(0, 240),
    lifecycleVisitorHash(visitorId),
    clean(input.shopifyCustomerId, 160),
    input.eventName,
    occurredAt,
    clean(input.productHandle, 180),
    clean(input.productName, 240),
    clean(input.productImage, 1200),
    clean(input.variantId, 180),
    clean(input.variantName, 180),
    Number.isFinite(input.quantity) ? Math.max(0, Math.floor(input.quantity!)) : null,
    clean(input.cartId, 240),
    clean(input.checkoutId, 240),
    payloadHash,
    occurredAt,
    new Date().toISOString(),
  ).run();
  return true;
}
