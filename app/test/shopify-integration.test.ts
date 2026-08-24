import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { normalizePaidOrderWebhook, normalizeShopifyPixelEvent, verifyShopifyWebhookHmac } from "../src/lib/shopify-integration.js";

const secret = "local-test-webhook-secret";
const body = JSON.stringify({
  id: 123,
  admin_graphql_api_id: "gid://shopify/Order/123",
  checkout_token: "checkout-123",
  current_total_price: "179.38",
  presentment_currency: "ILS",
  processed_at: "2026-08-13T10:00:00.000Z",
});
const hmac = createHmac("sha256", secret).update(body).digest("base64");

test("Shopify webhook HMAC accepts the exact body and rejects tampering", () => {
  assert.equal(verifyShopifyWebhookHmac(body, hmac, secret), true);
  assert.equal(verifyShopifyWebhookHmac(`${body} `, hmac, secret), false);
});

test("paid order normalization reduces a webhook without retaining raw customer data", () => {
  const result = normalizePaidOrderWebhook({
    rawBody: body,
    hmacSha256: hmac,
    topic: "orders/paid",
    shopDomain: "example.myshopify.com",
    expectedShopDomain: "example.myshopify.com",
    webhookSecret: secret,
  });
  assert.equal(result.accepted, true);
  if (result.accepted) {
    assert.equal(result.value.orderGid, "gid://shopify/Order/123");
    assert.equal(result.value.grossAmount, 179.38);
    assert.equal("email" in result.value.payload, false);
  }
});

test("pixel adapter accepts checkout events, keeps a stable event key and preserves commerce session id", () => {
  const result = normalizeShopifyPixelEvent({
    id: "pixel-event-1",
    name: "checkout_started",
    timestamp: "2026-08-13T10:00:00.000Z",
    data: { checkout: { token: "checkout-123" } },
  }, {
    shopDomain: "example.myshopify.com",
    visitorId: "visitor-1",
    funnelId: "funnel-1",
    stepId: "step-1",
    variantId: "variant-a",
    sessionId: "commerce-session-1",
  });
  assert.equal(result.accepted, true);
  if (result.accepted) {
    assert.equal(result.value.eventKey, "shopify:pixel:pixel-event-1");
    assert.equal(result.value.checkoutToken, "checkout-123");
    assert.equal(result.value.payload.sessionId, "commerce-session-1");
  }
});
