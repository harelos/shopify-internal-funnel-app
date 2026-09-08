import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  isShopifyStorefrontProxyPath,
  verifyShopifyAppProxySignature,
} from "../src/lib/shopify-app-proxy-auth.ts";

const secret = "proxy-test-secret";
const shop = "jacobfelipe.myshopify.com";

function signedRequest(overrides: Record<string, string> = {}) {
  const query: Record<string, string> = {
    logged_in_customer_id: "",
    path_prefix: "/apps/funnels",
    shop,
    timestamp: String(Math.floor(Date.now() / 1000)),
    ...overrides,
  };
  const message = Object.keys(query).sort().map(key => `${key}=${query[key]}`).join("");
  query.signature = createHmac("sha256", secret).update(message).digest("hex");
  return query;
}

test("accepts a current Shopify-signed App Proxy query", () => {
  assert.equal(verifyShopifyAppProxySignature(signedRequest(), secret, shop), true);
});

test("rejects stale or cross-shop App Proxy queries", () => {
  assert.equal(verifyShopifyAppProxySignature(signedRequest({ timestamp: "1" }), secret, shop), false);
  assert.equal(verifyShopifyAppProxySignature(signedRequest({ shop: "other.myshopify.com" }), secret, shop), false);
});

test("allows only the explicit storefront endpoints", () => {
  for (const path of ["/track", "/ai-chat", "/popup/confirm-lead", "/popup/customer/result-email", "/popup-trigger-config", "/cart-offers-config", "/proxy-health", "/proxy-health/"]) {
    assert.equal(isShopifyStorefrontProxyPath(path), true, path);
  }
  for (const path of ["/ai-steps", "/ai-conversations", "/analytics/popup", "/unknown"]) {
    assert.equal(isShopifyStorefrontProxyPath(path), false, path);
  }
});
