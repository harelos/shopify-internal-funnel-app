import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeFunnelContext,
  normalizeShopifyPixelEvent,
} from "../src/lib/shopify-integration.js";

test("Shopify pixel context keeps only bounded pseudonymous attribution fields", () => {
  const normalized = normalizeFunnelContext({
    visitorId: "visitor-1",
    email: "customer@example.com",
    phone: "+972500000000",
    firstTouch: {
      utmSource: "facebook",
      utmMedium: "paid_social",
      utmCampaign: "roots".repeat(100),
      adId: "ad-123",
      landingPath: "/pages/novahair-sales-staging",
      customerEmail: "customer@example.com",
    },
    lastTouch: {utmSource: "email", gclid: "gclid-1"},
    posthogDistinctId: "ph-anonymous-1",
    posthogSessionId: "ph-session-1",
    isInternal: true,
  }, "jacobfelipe.myshopify.com");

  assert.equal(normalized.shopDomain, "jacobfelipe.myshopify.com");
  assert.equal(normalized.firstTouch?.utmSource, "facebook");
  assert.equal(normalized.firstTouch?.utmCampaign?.length, 180);
  assert.equal(normalized.firstTouch?.adId, "ad-123");
  assert.equal(normalized.posthogDistinctId, "ph-anonymous-1");
  assert.equal(normalized.isInternal, true);
  assert.doesNotMatch(JSON.stringify(normalized), /customer@example|\+9725|customerEmail/);
});

test("checkout completion reads order and customer IDs from Shopify's checkout object", () => {
  const result = normalizeShopifyPixelEvent({
    id: "pixel-event-1",
    name: "checkout_completed",
    timestamp: "2026-09-08T12:00:00.000Z",
    data: {
      checkout: {
        token: "checkout-token-1",
        order: {
          id: "gid://shopify/Order/123",
          customer: {id: "gid://shopify/Customer/456"},
        },
      },
    },
  }, normalizeFunnelContext({
    visitorId: "visitor-1",
    firstTouch: {utmSource: "facebook", utmMedium: "paid_social", utmCampaign: "roots"},
    lastTouch: {utmSource: "email", utmCampaign: "follow-up"},
    posthogDistinctId: "ph-anonymous-1",
    posthogSessionId: "ph-session-1",
  }, "jacobfelipe.myshopify.com"));

  assert.equal(result.accepted, true);
  if (!result.accepted) return;
  assert.equal(result.value.orderGid, "gid://shopify/Order/123");
  assert.equal(result.value.shopifyCustomerId, "gid://shopify/Customer/456");
  assert.equal(result.value.checkoutToken, "checkout-token-1");
  assert.equal(result.value.utmSource, "facebook");
  assert.equal(result.value.posthogSessionId, "ph-session-1");
  assert.equal(result.value.payload.lastTouchUtmSource, "email");
});

test("checkout pixel keeps the Concierge marker as restricted attribution evidence", () => {
  const context = normalizeFunnelContext({
    concierge: {
      popup: true,
      conversationId: "conversation-1",
      visitorId: "visitor-1",
      sessionId: "session-1",
      version: "novahair_ai_v1",
      agent: "sales",
      trigger: "bundle",
      device: "mobile",
      email: "must-not-survive@example.com",
    },
  }, "jacobfelipe.myshopify.com");
  const result = normalizeShopifyPixelEvent({
    id: "pixel-event-concierge", name: "checkout_started", timestamp: "2026-09-08T12:00:00.000Z",
    data: { checkout: { token: "checkout-token-concierge" } },
  }, context);
  assert.equal(result.accepted, true);
  if (!result.accepted) return;
  assert.equal(result.value.payload.conciergeMarkerPresent, true);
  assert.equal(result.value.payload.conciergeConversationId, "conversation-1");
  assert.doesNotMatch(JSON.stringify(result.value), /must-not-survive|@example/);
});

test("unsupported pixel events and missing IDs fail closed", () => {
  const context = normalizeFunnelContext({}, "jacobfelipe.myshopify.com");
  assert.deepEqual(normalizeShopifyPixelEvent({id: "one", name: "page_viewed"}, context), {
    accepted: false,
    reason: "pixel_event_not_used_for_funnel_reporting",
  });
  assert.deepEqual(normalizeShopifyPixelEvent({name: "checkout_started"}, context), {
    accepted: false,
    reason: "pixel_event_id_and_name_required",
  });
});

test("QA campaign markers are excluded even when a client omits its internal flag", () => {
  const context = normalizeFunnelContext({
    firstTouch: {utmSource: "facebook", utmCampaign: "novahair_qa_checkout"},
  }, "jacobfelipe.myshopify.com");
  assert.equal(context.isInternal, true);
});
