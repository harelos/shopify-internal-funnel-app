import assert from "node:assert/strict";
import test from "node:test";
import { EXPECTED_SHOPIFY_PIXEL_ENDPOINT, publicShopifyPixelStatus } from "../src/lib/shopify-pixel-status.js";

test("pixel status exposes health booleans without leaking settings or the Shopify pixel id", () => {
  const status = publicShopifyPixelStatus({
    id: "gid://shopify/WebPixel/secret-provider-id",
    settings: JSON.stringify({ accountID: "private", endpoint: EXPECTED_SHOPIFY_PIXEL_ENDPOINT }),
  });

  assert.deepEqual(status, {
    state: "CURRENT",
    configured: true,
    pixelIdPresent: true,
    endpointMatches: true,
    expectedEndpointHost: "shopify-funnel-control.tigerbrands-funnel.workers.dev",
  });
  assert.doesNotMatch(JSON.stringify(status), /secret-provider-id|private/);
});

test("pixel status fails closed when the endpoint is absent or the pixel does not exist", () => {
  assert.equal(publicShopifyPixelStatus({ id: "pixel", settings: { endpoint: "https://wrong.example.test" } }).state, "ATTENTION");
  assert.equal(publicShopifyPixelStatus(null).state, "ATTENTION");
});
