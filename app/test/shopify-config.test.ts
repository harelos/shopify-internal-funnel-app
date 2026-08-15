import assert from "node:assert/strict";
import { test } from "node:test";
import { getShopifyConfig, missingShopifyConfiguration, normalizeShopDomain, publicShopifyStatus } from "../src/lib/shopify-config.js";

const keys = [
  "SHOP_DOMAIN",
  "ALLOWED_SHOP_DOMAIN",
  "SHOPIFY_DISTRIBUTION",
  "SHOPIFY_CLIENT_ID",
  "SHOPIFY_CLIENT_SECRET",
  "SHOPIFY_ACCESS_TOKEN",
  "SHOPIFY_LIVE_CONNECT",
];

function withEnv(values: Record<string, string | undefined>, callback: () => void) {
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  for (const key of keys) {
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  try {
    callback();
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("normalizes and validates a Shopify domain without exposing credentials", () => {
  assert.equal(normalizeShopDomain("https://Example.myshopify.com/"), "example.myshopify.com");
});

test("custom embedded mode uses token exchange and does not require a static access token", () => {
  withEnv({
    SHOP_DOMAIN: "example.myshopify.com",
    SHOPIFY_DISTRIBUTION: "custom",
    SHOPIFY_CLIENT_ID: "client-id",
    SHOPIFY_CLIENT_SECRET: "client-secret",
    SHOPIFY_ACCESS_TOKEN: undefined,
    SHOPIFY_LIVE_CONNECT: "true",
  }, () => {
    const config = getShopifyConfig();
    assert.equal(config.hasAccessToken, false);
    assert.deepEqual(missingShopifyConfiguration(), []);
    assert.equal(publicShopifyStatus().tokenExchangeReady, true);
  });
});

test("Admin-created mode requires a server-only access token", () => {
  withEnv({
    SHOP_DOMAIN: "example.myshopify.com",
    SHOPIFY_DISTRIBUTION: "shopify-admin",
    SHOPIFY_CLIENT_ID: "client-id",
    SHOPIFY_CLIENT_SECRET: "client-secret",
    SHOPIFY_ACCESS_TOKEN: undefined,
  }, () => {
    assert.deepEqual(missingShopifyConfiguration(), ["SHOPIFY_ACCESS_TOKEN"]);
    assert.equal(publicShopifyStatus().adminCreatedCannotEmbed, true);
  });
});

