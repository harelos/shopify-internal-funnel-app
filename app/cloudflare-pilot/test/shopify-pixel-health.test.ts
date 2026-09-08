import assert from "node:assert/strict";
import test from "node:test";
import { EXPECTED_SHOPIFY_PIXEL_ENDPOINT } from "../src/lib/shopify-pixel-status.js";
import { probeShopifyPixelHealth } from "../src/services/shopify-pixel-health.js";

test("live pixel health verifies granted scope, configured pixel and endpoint", async () => {
  const status = await probeShopifyPixelHealth({
    async appAccessScopes() { return { currentAppInstallation: { accessScopes: [{ handle: "read_pixels" }] } }; },
    async webPixelConfiguration() { return { webPixel: { id: "pixel", settings: { endpoint: EXPECTED_SHOPIFY_PIXEL_ENDPOINT } } }; },
  });
  assert.equal(status.reason, "VERIFIED");
  assert.equal(status.state, "CURRENT");
});

test("live pixel health explains a missing Shopify permission without querying pixel settings", async () => {
  let queried = false;
  const status = await probeShopifyPixelHealth({
    async appAccessScopes() { return { currentAppInstallation: { accessScopes: [{ handle: "read_orders" }] } }; },
    async webPixelConfiguration() { queried = true; return { webPixel: null }; },
  });
  assert.equal(status.reason, "READ_PIXELS_SCOPE_NOT_GRANTED");
  assert.equal(queried, false);
});

test("live pixel health returns a bounded reason instead of a provider error", async () => {
  const status = await probeShopifyPixelHealth({
    async appAccessScopes() { throw new Error("Shopify Admin API GraphQL error: Access denied for field with sensitive details"); },
    async webPixelConfiguration() { return { webPixel: null }; },
  });
  assert.equal(status.reason, "SHOPIFY_ACCESS_DENIED");
  assert.doesNotMatch(JSON.stringify(status), /sensitive details/);
});
