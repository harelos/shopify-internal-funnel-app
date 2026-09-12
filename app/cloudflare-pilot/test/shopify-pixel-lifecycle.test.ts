import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeShopifyPixelEvent } from "../src/lib/shopify-integration.js";

const context = {
  shopDomain: "jacobfelipe.myshopify.com",
  visitorId: "v_known_browser",
  shopifyCustomerId: "gid://shopify/Customer/123",
};

test("Shopify pixel normalization accepts only the lifecycle event allowlist and reduces its payload", () => {
  const result = normalizeShopifyPixelEvent({
    id: "pixel-1",
    name: "product_added_to_cart",
    timestamp: "2026-09-12T12:00:00.000Z",
    clientId: "shopify-client-1",
    data: {
      cartId: "gid://shopify/Cart/1",
      productHandle: "novahair",
      productName: "NovaHair",
      productImage: "https://cdn.shopify.com/novahair.png",
      variantId: "gid://shopify/ProductVariant/1",
      variantName: "Dark Brown / 4",
      quantity: 4,
      email: "must-not-be-preserved@example.com",
    },
  }, context);
  assert.equal(result.accepted, true);
  if (!result.accepted) return;
  assert.equal(result.value.name, "CART_ACTIVITY");
  assert.equal(result.value.visitorId, "v_known_browser");
  assert.equal(result.value.productHandle, "novahair");
  assert.equal(result.value.quantity, 4);
  assert.equal("email" in result.value.payload, false);

  const rejected = normalizeShopifyPixelEvent({ id: "pixel-2", name: "page_viewed" }, context);
  assert.deepEqual(rejected, { accepted: false, reason: "pixel_event_not_used_for_funnel_reporting" });
});

test("Shopify client ID is a stable fallback when the funnel visitor cookie is absent", () => {
  const result = normalizeShopifyPixelEvent({
    id: "pixel-3",
    name: "product_viewed",
    clientId: "shopify-client-known",
    data: { productHandle: "novahair" },
  }, { shopDomain: "jacobfelipe.myshopify.com" });
  assert.equal(result.accepted, true);
  if (result.accepted) assert.equal(result.value.visitorId, "shopify-client-known");
});
