import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { FunnelService } from "../src/funnel-service.js";
import { normalizePaidOrderWebhook, normalizeShopifyPixelEvent, verifyShopifyWebhookHmac } from "../src/shopify-integration.js";

const context = {
  shopDomain: "dev-store.myshopify.com",
  visitorId: "visitor-1",
  funnelId: "funnel-1",
  stepId: "step-1",
  variantId: "variant-a",
};

test("normalizes checkout-start pixel events without retaining raw payload", () => {
  const result = normalizeShopifyPixelEvent({
    id: "pixel-1",
    name: "checkout_started",
    timestamp: "2026-08-12T12:00:00.000Z",
    data: { checkout: { token: "checkout-1" }, customer: { email: "must-not-be-retained@example.test" } },
  }, context);

  assert.equal(result.accepted, true);
  if (!result.accepted) return;
  assert.equal(result.value.name, "CART_CHECKOUT_STARTED");
  assert.equal(result.value.checkoutToken, "checkout-1");
  assert.equal(result.value.payload.hasCheckoutToken, true);
  assert.equal("customer" in result.value.payload, false);
});

test("ignores pixel page views and maps observed completion separately", () => {
  const ignored = normalizeShopifyPixelEvent({ id: "pixel-page", name: "page_viewed", data: {} }, context);
  assert.deepEqual(ignored, { accepted: false, reason: "pixel_event_not_used_for_funnel_reporting" });

  const completed = normalizeShopifyPixelEvent({
    id: "pixel-complete",
    name: "checkout_completed",
    data: { checkout: { token: "checkout-1" }, order: { id: "gid://shopify/Order/10" } },
  }, context);
  assert.equal(completed.accepted, true);
  if (!completed.accepted) return;
  assert.equal(completed.value.name, "CHECKOUT_COMPLETED_OBSERVED");
  assert.equal(completed.value.orderGid, "gid://shopify/Order/10");
});

test("verifies webhook HMAC and rejects tampering", () => {
  const secret = "fixture-webhook-secret";
  const body = JSON.stringify({ id: 10, checkout_token: "checkout-1", total_price: "42.50", currency: "usd" });
  const hmac = createHmac("sha256", secret).update(body).digest("base64");
  assert.equal(verifyShopifyWebhookHmac(body, hmac, secret), true);
  assert.equal(verifyShopifyWebhookHmac(`${body} `, hmac, secret), false);
  assert.equal(verifyShopifyWebhookHmac(body, undefined, secret), false);
});

test("reduces an allowlisted orders/paid webhook to attribution-safe fields", () => {
  const secret = "fixture-webhook-secret";
  const body = JSON.stringify({
    id: 10,
    checkout_token: "checkout-1",
    total_price: "42.50",
    currency: "usd",
    created_at: "2026-08-12T12:00:00.000Z",
    email: "must-not-be-retained@example.test",
  });
  const hmac = createHmac("sha256", secret).update(body).digest("base64");
  const result = normalizePaidOrderWebhook({
    rawBody: body,
    hmacSha256: hmac,
    topic: "orders/paid",
    shopDomain: "DEV-STORE.MYSHOPIFY.COM/",
    expectedShopDomain: "dev-store.myshopify.com",
    webhookSecret: secret,
  });

  assert.equal(result.accepted, true);
  if (!result.accepted) return;
  assert.equal(result.value.name, "SHOPIFY_ORDER_PAID");
  assert.equal(result.value.orderGid, "gid://shopify/Order/10");
  assert.equal(result.value.grossAmount, 42.5);
  assert.equal(result.value.currency, "USD");
  assert.equal(result.value.payload.hasCheckoutToken, true);
  assert.equal("email" in result.value.payload, false);
});

test("rejects wrong topic, wrong shop, and malformed order data", () => {
  const secret = "fixture-webhook-secret";
  const body = JSON.stringify({ id: 10, total_price: "not-a-number", currency: "USD" });
  const hmac = createHmac("sha256", secret).update(body).digest("base64");
  const base = { rawBody: body, hmacSha256: hmac, expectedShopDomain: "dev-store.myshopify.com", webhookSecret: secret };
  assert.equal(normalizePaidOrderWebhook({ ...base, topic: "orders/create", shopDomain: "dev-store.myshopify.com" }).accepted, false);
  assert.equal(normalizePaidOrderWebhook({ ...base, topic: "orders/paid", shopDomain: "other-store.myshopify.com" }).accepted, false);
  assert.equal(normalizePaidOrderWebhook({ ...base, topic: "orders/paid", shopDomain: "dev-store.myshopify.com" }).accepted, false);
});

test("accepted paid webhook reaches the attribution service and remains idempotent", () => {
  const secret = "fixture-webhook-secret";
  const body = JSON.stringify({ id: 11, total_price: "19.99", currency: "USD" });
  const hmac = createHmac("sha256", secret).update(body).digest("base64");
  const normalized = normalizePaidOrderWebhook({
    rawBody: body,
    hmacSha256: hmac,
    topic: "orders/paid",
    shopDomain: "dev-store.myshopify.com",
    expectedShopDomain: "dev-store.myshopify.com",
    webhookSecret: secret,
  });
  assert.equal(normalized.accepted, true);
  if (!normalized.accepted) return;

  const service = new FunnelService();
  const shop = service.createShop("dev-store.myshopify.com");
  const first = service.ingestShopifyIntegrationEvent(shop.id, normalized.value);
  const replay = service.ingestShopifyIntegrationEvent(shop.id, normalized.value);
  assert.equal(first.duplicate, false);
  assert.equal(first.orderAttribution?.confidence, "UNATTRIBUTED");
  assert.equal(replay.duplicate, true);
  assert.equal(service.store.orderAttributions.size, 1);
});
