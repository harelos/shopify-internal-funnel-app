import test from "node:test";
import assert from "node:assert/strict";
import { ShopifyAdminClient } from "../src/lib/shopify-admin.js";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

function configure() {
  process.env.SHOP_DOMAIN = "retry-test.myshopify.com";
  process.env.SHOPIFY_LIVE_CONNECT = "true";
  process.env.SHOPIFY_ACCESS_TOKEN = "test-access-token";
  process.env.SHOPIFY_API_VERSION = "2026-07";
}

function restore() {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
}

test("Shopify Admin client retries GraphQL THROTTLED response and then succeeds", async () => {
  configure();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({
        errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
        extensions: { cost: { throttleStatus: { currentlyAvailable: 49, restoreRate: 1000 } } },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ data: { shop: { name: "Retry Shop" } } }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const client = new ShopifyAdminClient();
    const result = await client.graphql<{ shop: { name: string } }>("query { shop { name } }");
    assert.equal(result.shop.name, "Retry Shop");
    assert.equal(calls, 2);
  } finally {
    restore();
  }
});

test("Shopify Admin client does not retry ordinary GraphQL validation errors", async () => {
  configure();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ errors: [{ message: "Field does not exist", extensions: { code: "GRAPHQL_VALIDATION_FAILED" } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const client = new ShopifyAdminClient();
    await assert.rejects(client.graphql("query { nope }"), /Field does not exist/);
    assert.equal(calls, 1);
  } finally {
    restore();
  }
});
