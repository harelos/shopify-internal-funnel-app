import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "../src/worker";
import { TEST_EMAIL, testDatabase, testEnv } from "./helpers/d1";

const context = {
  waitUntil() {},
};

test("private health endpoint is hidden without auth and contains no PII with auth", async () => {
  const { db, dispose } = await testDatabase();
  const env = testEnv(db);
  try {
    const hidden = await worker.fetch(
      new Request("https://worker.test/api/lifecycle/health"),
      env,
      context,
    );
    assert.equal(hidden.status, 404);

    const visible = await worker.fetch(
      new Request("https://worker.test/api/lifecycle/health", {
        headers: { Authorization: "Bearer test_admin_token" },
      }),
      env,
      context,
    );
    assert.equal(visible.status, 200);
    const body = await visible.text();
    assert.doesNotMatch(body, new RegExp(TEST_EMAIL.replace(".", "\\."), "i"));
    assert.doesNotMatch(body, /test_shopify_token|test_resend_key|sensitive-token/i);
  } finally {
    await dispose();
  }
});

test("Worker rejects unsigned Shopify and Resend webhook requests", async () => {
  const { db, dispose } = await testDatabase();
  const env = testEnv(db);
  try {
    const shopify = await worker.fetch(
      new Request("https://worker.test/api/lifecycle/webhooks/shopify", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-shopify-topic": "orders/paid",
          "x-shopify-shop-domain": "jacobfelipe.myshopify.com",
          "x-shopify-webhook-id": "unsigned-shopify",
        },
        body: JSON.stringify({ id: 1, email: TEST_EMAIL }),
      }),
      env,
      context,
    );
    assert.equal(shopify.status, 401);

    const resend = await worker.fetch(
      new Request("https://worker.test/api/lifecycle/webhooks/resend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "email.sent", data: { to: [TEST_EMAIL] } }),
      }),
      env,
      context,
    );
    assert.equal(resend.status, 400);
  } finally {
    await dispose();
  }
});

test("Shopify lifecycle webhooks are provisioned idempotently for orders and fulfillment tracking", async () => {
  const { db, dispose } = await testDatabase();
  const originalFetch = globalThis.fetch;
  const subscriptions: Array<{ id: string; topic: string; uri: string }> = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      query: string;
      variables: { topic?: string; uri?: string };
    };
    if (body.query.includes("NovaHairWebhookSubscriptions")) {
      return Response.json({ data: { webhookSubscriptions: { nodes: subscriptions } } });
    }
    const created = {
      id: `gid://shopify/WebhookSubscription/${subscriptions.length + 1}`,
      topic: String(body.variables.topic),
      uri: String(body.variables.uri),
    };
    subscriptions.push(created);
    return Response.json({
      data: {
        webhookSubscriptionCreate: { webhookSubscription: created, userErrors: [] },
      },
    });
  };
  try {
    const env = testEnv(db);
    const request = () => new Request("https://worker.test/api/lifecycle/admin/shopify-webhooks", {
      method: "POST",
      headers: { Authorization: "Bearer test_admin_token" },
    });
    const first = await worker.fetch(request(), env, context);
    assert.equal(first.status, 200);
    assert.equal((await first.json() as { created: number }).created, 5);
    assert.deepEqual(subscriptions.map(item => item.topic).sort(), [
      "FULFILLMENTS_CREATE",
      "FULFILLMENTS_UPDATE",
      "FULFILLMENT_EVENTS_CREATE",
      "ORDERS_CREATE",
      "ORDERS_PAID",
    ]);
    assert.ok(subscriptions.every(item => item.uri.endsWith("/api/lifecycle/webhooks/shopify")));

    const second = await worker.fetch(request(), env, context);
    assert.equal(second.status, 200);
    assert.equal((await second.json() as { created: number }).created, 0);
    assert.equal(subscriptions.length, 5);
  } finally {
    globalThis.fetch = originalFetch;
    await dispose();
  }
});
