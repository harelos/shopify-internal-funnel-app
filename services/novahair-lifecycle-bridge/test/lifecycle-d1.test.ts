import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { hmacSha256Base64 } from "../src/crypto";
import { dispatchDueLifecycleEvents } from "../src/dispatch";
import { healthValue } from "../src/db";
import { replenishmentOffsetDays } from "../src/flow-specs";
import { classifyResendResponse, dispatchResendContactUpdates, sendLifecycleEvent } from "../src/resend";
import { syncAbandonedCheckouts, syncCustomerConsent, syncPaidOrders, upsertCheckout } from "../src/shopify";
import { handleResendWebhook, processFulfillmentObservation, processShopifyLifecycleWebhook } from "../src/webhooks";
import { checkoutFixture, TEST_EMAIL, testDatabase, testEnv } from "./helpers/d1";

test("D1 migration installs lifecycle state, idempotency, attribution, health, and indexes", async () => {
  const { db, dispose } = await testDatabase();
  try {
    const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
    const names = new Set(tables.results.map((row: { name: string }) => row.name));
    for (const name of [
      "abandoned_checkouts", "shopify_event_receipts", "resend_events", "email_delivery_events",
      "automation_tracking", "suppressions", "lifecycle_errors", "health_state",
      "scheduled_lifecycle_events", "lifecycle_orders", "lifecycle_attribution",
      "lifecycle_click_tokens", "lifecycle_usage_counters", "lifecycle_usage_event_receipts",
      "resend_contact_updates", "resend_resources",
    ]) assert.ok(names.has(name), name);
    const indexes = await db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_lifecycle_%'").first("count");
    assert.ok(Number(indexes) >= 10);
  } finally {
    await dispose();
  }
});

test("duplicate polls are idempotent and recovery is correlated to checkout ID, not email", async () => {
  const { db, dispose } = await testDatabase();
  const env = testEnv(db);
  const now = new Date("2026-09-08T02:00:00.000Z");
  try {
    const a = checkoutFixture("gid://shopify/AbandonedCheckout/A");
    const b = checkoutFixture("gid://shopify/AbandonedCheckout/B");
    await upsertCheckout(env, a, now);
    await upsertCheckout(env, a, now);
    await upsertCheckout(env, b, now);
    const initial = await db.prepare("SELECT COUNT(*) AS count FROM scheduled_lifecycle_events").first("count");
    assert.equal(Number(initial), 24, "10 emails + 2 stage stops per distinct checkout");

    await upsertCheckout(env, checkoutFixture("gid://shopify/AbandonedCheckout/A", {
      updatedAt: "2026-09-08T02:05:00.000Z",
      completedAt: "2026-09-08T02:05:00.000Z",
    }), new Date("2026-09-08T02:05:00.000Z"));

    const states = await db.prepare("SELECT shopify_checkout_id, state FROM abandoned_checkouts ORDER BY shopify_checkout_id").all();
    assert.deepEqual(states.results.map((row: { shopify_checkout_id: string; state: string }) => [row.shopify_checkout_id, row.state]), [
      ["gid://shopify/AbandonedCheckout/A", "RECOVERED"],
      ["gid://shopify/AbandonedCheckout/B", "ABANDONED"],
    ]);
    const aPendingEmails = await db.prepare("SELECT COUNT(*) AS count FROM scheduled_lifecycle_events WHERE entity_id = ? AND event_name = 'shopify.checkout_abandoned' AND status != 'CANCELLED'").bind("gid://shopify/AbandonedCheckout/A").first("count");
    const bPendingEmails = await db.prepare("SELECT COUNT(*) AS count FROM scheduled_lifecycle_events WHERE entity_id = ? AND event_name = 'shopify.checkout_abandoned' AND status = 'PENDING'").bind("gid://shopify/AbandonedCheckout/B").first("count");
    assert.equal(Number(aPendingEmails), 0);
    assert.equal(Number(bPendingEmails), 10);
  } finally {
    await dispose();
  }
});

test("recovery before Email 1 prevents it; recovery after Email 1 prevents Email 2", async () => {
  const { db, dispose } = await testDatabase();
  const env = testEnv(db);
  try {
    const beforeId = "gid://shopify/AbandonedCheckout/BEFORE";
    await upsertCheckout(env, checkoutFixture(beforeId), new Date("2026-09-08T00:20:00.000Z"));
    await upsertCheckout(env, checkoutFixture(beforeId, {
      updatedAt: "2026-09-08T00:30:00.000Z",
      completedAt: "2026-09-08T00:30:00.000Z",
    }), new Date("2026-09-08T00:30:00.000Z"));
    const before = await db.prepare("SELECT status FROM scheduled_lifecycle_events WHERE idempotency_key = ?").bind(`checkout:${beforeId}:email:1`).first("status");
    assert.equal(before, "CANCELLED");

    const afterId = "gid://shopify/AbandonedCheckout/AFTER";
    await upsertCheckout(env, checkoutFixture(afterId), new Date("2026-09-08T02:00:00.000Z"));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ id: "evt_test" }), { status: 200, headers: { "content-type": "application/json" } });
    try {
      const dispatched = await dispatchDueLifecycleEvents(env, new Date("2026-09-08T02:00:00.000Z"), "test-owner");
      assert.equal(dispatched.failed, 0);
      assert.ok(dispatched.sent >= 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
    await upsertCheckout(env, checkoutFixture(afterId, {
      updatedAt: "2026-09-08T02:05:00.000Z",
      completedAt: "2026-09-08T02:05:00.000Z",
    }), new Date("2026-09-08T02:05:00.000Z"));
    const e1 = await db.prepare("SELECT status FROM scheduled_lifecycle_events WHERE idempotency_key = ?").bind(`checkout:${afterId}:email:1`).first("status");
    const e2 = await db.prepare("SELECT status FROM scheduled_lifecycle_events WHERE idempotency_key = ?").bind(`checkout:${afterId}:email:2`).first("status");
    assert.equal(e1, "DISPATCHED");
    assert.equal(e2, "CANCELLED");
  } finally {
    await dispose();
  }
});

test("unsubscribed Shopify customer never gets an abandoned-checkout marketing schedule", async () => {
  const { db, dispose } = await testDatabase();
  const env = testEnv(db);
  try {
    const id = "gid://shopify/AbandonedCheckout/UNSUB";
    await upsertCheckout(env, checkoutFixture(id, { consent: "UNSUBSCRIBED" }), new Date("2026-09-08T02:00:00.000Z"));
    const row = await db.prepare("SELECT state FROM abandoned_checkouts WHERE shopify_checkout_id = ?").bind(id).first<{ state: string }>();
    const emails = await db.prepare("SELECT COUNT(*) AS count FROM scheduled_lifecycle_events WHERE entity_id = ? AND event_name = 'shopify.checkout_abandoned'").bind(id).first("count");
    assert.equal(row?.state, "INELIGIBLE");
    assert.equal(Number(emails), 0);
  } finally {
    await dispose();
  }
});

test("test activation cutoff prevents historical checkouts from entering a new lifecycle", async () => {
  const { db, dispose } = await testDatabase();
  const env = testEnv(db, { LIFECYCLE_ACTIVATED_AT: "2026-09-08T01:00:00.000Z" });
  try {
    const id = "gid://shopify/AbandonedCheckout/HISTORICAL";
    await upsertCheckout(env, checkoutFixture(id, {
      createdAt: "2026-09-08T00:30:00.000Z",
      updatedAt: "2026-09-08T00:45:00.000Z",
    }), new Date("2026-09-08T02:00:00.000Z"));
    assert.equal(
      await db.prepare("SELECT state FROM abandoned_checkouts WHERE shopify_checkout_id = ?").bind(id).first("state"),
      "INELIGIBLE",
    );
    assert.equal(
      Number(await db.prepare("SELECT COUNT(*) AS count FROM scheduled_lifecycle_events WHERE entity_id = ?").bind(id).first("count")),
      0,
    );
  } finally {
    await dispose();
  }
});

function orderRequest(payload: Record<string, unknown>, eventId: string, topic = "orders/paid") {
  const withShipping = {
    shipping_country_code: "IL",
    shipping_country_code_v2: "IL",
    shipping_country: "ישראל",
    ...payload,
  } as Record<string, unknown>;
  const raw = JSON.stringify(withShipping);
  return hmacSha256Base64("test_shopify_webhook_secret", raw).then(hmac => new Request("https://worker.test/webhooks/shopify", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shopify-hmac-sha256": hmac,
      "x-shopify-topic": topic,
      "x-shopify-shop-domain": "jacobfelipe.myshopify.com",
      "x-shopify-webhook-id": eventId,
    },
    body: raw,
  }));
}

test("verified paid order is the global stop and starts post-purchase/replenishment once", async () => {
  const { db, dispose } = await testDatabase();
  const env = testEnv(db);
  try {
    await upsertCheckout(env, checkoutFixture("gid://shopify/AbandonedCheckout/100"), new Date("2026-09-08T02:00:00.000Z"));
    await upsertCheckout(env, checkoutFixture("gid://shopify/AbandonedCheckout/200"), new Date("2026-09-08T02:00:00.000Z"));
    const payload = {
      id: 500,
      admin_graphql_api_id: "gid://shopify/Order/500",
      checkout_id: 100,
      email: TEST_EMAIL,
      customer: { id: 9001, admin_graphql_api_id: "gid://shopify/Customer/9001", first_name: "הראל", email: TEST_EMAIL },
      processed_at: "2026-09-08T02:10:00.000Z",
      currency: "ILS",
      total_price: "189.00",
      financial_status: "paid",
      test: true,
      line_items: [{ title: "NOVAHAIR", variant_title: "2 בקבוקים / חום כהה", quantity: 2, sku: "NOVASALE-2" }],
    };
    const first = await processShopifyLifecycleWebhook(env, await orderRequest(payload, "shopify-event-paid-500"), new Date("2026-09-08T02:10:00.000Z"));
    assert.deepEqual(first, { accepted: true });
    const duplicate = await processShopifyLifecycleWebhook(env, await orderRequest(payload, "shopify-event-paid-500"), new Date("2026-09-08T02:11:00.000Z"));
    assert.deepEqual(duplicate, { accepted: true, duplicate: true });

    const checkoutStates = await db.prepare("SELECT state FROM abandoned_checkouts WHERE email = ?").bind(TEST_EMAIL).all();
    assert.deepEqual(new Set(checkoutStates.results.map((row: { state: string }) => row.state)), new Set(["PURCHASED"]));
    assert.equal(Number(await db.prepare("SELECT COUNT(*) AS count FROM lifecycle_orders").first("count")), 1);
    assert.equal(Number(await db.prepare("SELECT COUNT(*) AS count FROM scheduled_lifecycle_events WHERE event_name = 'shopify.post_purchase_started'").first("count")), 4);
    assert.equal(Number(await db.prepare("SELECT COUNT(*) AS count FROM scheduled_lifecycle_events WHERE event_name = 'shopify.replenishment_due'").first("count")), 1);
    assert.equal(Number(await db.prepare("SELECT COUNT(*) AS count FROM scheduled_lifecycle_events WHERE event_name = 'shopify.checkout_abandoned' AND status IN ('PENDING','RETRY','LEASED')").first("count")), 0);
  } finally {
    await dispose();
  }
});

test("post-purchase shipping updates are scheduled from purchase and usage emails from exact delivery", async () => {
  const { db, dispose } = await testDatabase();
  const env = testEnv(db);
  const paidPayload = (id: number) => ({
    id,
    admin_graphql_api_id: `gid://shopify/Order/${id}`,
    email: TEST_EMAIL,
    customer: {
      id: 9001,
      admin_graphql_api_id: "gid://shopify/Customer/9001",
      first_name: "הראל",
      email: TEST_EMAIL,
    },
    processed_at: "2026-09-08T02:10:00.000Z",
    currency: "ILS",
    total_price: "189.00",
    financial_status: "paid",
    test: true,
    marketing_consent_state: "SUBSCRIBED",
    line_items: [{ title: "NOVAHAIR", variant_title: "2 בקבוקים / חום כהה", quantity: 2 }],
  });
  try {
    await processShopifyLifecycleWebhook(
      env,
      await orderRequest(paidPayload(901), "shopify-event-paid-901"),
      new Date("2026-09-08T02:10:00.000Z"),
    );
    await processShopifyLifecycleWebhook(
      env,
      await orderRequest(paidPayload(902), "shopify-event-paid-902"),
      new Date("2026-09-08T02:11:00.000Z"),
    );

    assert.equal(Number(await db.prepare(
      "SELECT COUNT(*) AS count FROM scheduled_lifecycle_events WHERE entity_id = ? AND event_name = 'shopify.post_purchase_started'",
    ).bind("gid://shopify/Order/901").first("count")), 4);

    const delivered = await processFulfillmentObservation(env, {
      eventKey: "fulfillment-event-delivered-901",
      shopifyOrderId: "gid://shopify/Order/901",
      shopifyFulfillmentId: "gid://shopify/Fulfillment/501",
      status: "delivered",
      happenedAt: "2026-09-25T12:00:00.000Z",
      trackingCompany: "CJPacket YP Special Line",
      trackingNumber: "TRACKING-SECRET-901",
      trackingUrl: "https://tracking.example.invalid/secret-carrier-token-901",
      source: "POLL",
      payload: { id: 501, status: "delivered" },
    }, new Date("2026-09-25T12:05:00.000Z"));
    assert.deepEqual(delivered, { processed: true, delivered: true });
    await db.prepare(
      "DELETE FROM scheduled_lifecycle_events WHERE idempotency_key = ?",
    ).bind("order:gid://shopify/Order/901:post_purchase:email:5").run();
    const duplicate = await processFulfillmentObservation(env, {
      eventKey: "fulfillment-event-delivered-901",
      shopifyOrderId: "gid://shopify/Order/901",
      status: "DELIVERED",
      happenedAt: "2026-09-25T12:00:00.000Z",
      source: "WEBHOOK",
      payload: { duplicate: true },
    }, new Date("2026-09-25T12:06:00.000Z"));
    assert.deepEqual(duplicate, { processed: true, duplicate: true, delivered: true });

    assert.equal(Number(await db.prepare(
      "SELECT COUNT(*) AS count FROM scheduled_lifecycle_events WHERE entity_id = ? AND event_name = 'shopify.post_purchase_started'",
    ).bind("gid://shopify/Order/901").first("count")), 9);
    assert.equal(Number(await db.prepare(
      "SELECT COUNT(*) AS count FROM scheduled_lifecycle_events WHERE entity_id = ? AND event_name = 'shopify.post_purchase_started'",
    ).bind("gid://shopify/Order/902").first("count")), 4);
    assert.equal(await db.prepare(
      "SELECT delivered_at FROM lifecycle_orders WHERE shopify_order_id = ?",
    ).bind("gid://shopify/Order/901").first("delivered_at"), "2026-09-25T12:00:00.000Z");
    assert.equal(await db.prepare(
      "SELECT due_at FROM scheduled_lifecycle_events WHERE idempotency_key = ?",
    ).bind("order:gid://shopify/Order/901:post_purchase:email:5").first("due_at"), "2026-09-26T12:00:00.000Z");
    const stored = JSON.stringify(await db.prepare(
      "SELECT * FROM lifecycle_orders WHERE shopify_order_id = ?",
    ).bind("gid://shopify/Order/901").first());
    assert.doesNotMatch(stored, /TRACKING-SECRET-901|secret-carrier-token-901/);
  } finally {
    await dispose();
  }
});

test("post-purchase cross-sell is cancelled when every active candidate was already purchased", async () => {
  const { db, dispose } = await testDatabase();
  const env = testEnv(db);
  try {
    const payload = {
      id: 903,
      admin_graphql_api_id: "gid://shopify/Order/903",
      email: TEST_EMAIL,
      customer: { id: 9001, first_name: "הראל", email: TEST_EMAIL },
      processed_at: "2026-09-08T02:10:00.000Z",
      currency: "ILS",
      total_price: "399.00",
      financial_status: "paid",
      test: true,
      marketing_consent_state: "SUBSCRIBED",
      line_items: [
        { product_id: 9882294354215, title: "NOVAHAIR", variant_title: "2 בקבוקים / חום כהה", quantity: 2 },
        { product_id: 9943550624039, title: "ספריי היירגלוס לשיער", quantity: 1 },
        { product_id: 10341804081447, title: "BiotinRoot", quantity: 1 },
      ],
    };
    await processShopifyLifecycleWebhook(
      env,
      await orderRequest(payload, "shopify-event-paid-903"),
      new Date("2026-09-08T02:10:00.000Z"),
    );
    await processFulfillmentObservation(env, {
      eventKey: "fulfillment-event-delivered-903",
      shopifyOrderId: "gid://shopify/Order/903",
      status: "DELIVERED",
      happenedAt: "2026-09-20T12:00:00.000Z",
      source: "WEBHOOK",
      payload: { order_id: 903, status: "delivered" },
    }, new Date("2026-09-20T12:01:00.000Z"));

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ id: crypto.randomUUID() });
    try {
      await dispatchDueLifecycleEvents(env, new Date("2026-10-12T12:00:00.000Z"), "cross-sell-test");
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(await db.prepare(
      "SELECT status FROM scheduled_lifecycle_events WHERE idempotency_key = ?",
    ).bind("order:gid://shopify/Order/903:post_purchase:email:9").first("status"), "CANCELLED");
    assert.equal(Number(await db.prepare(
      "SELECT COUNT(*) AS count FROM resend_events WHERE idempotency_key = ?",
    ).bind("order:gid://shopify/Order/903:post_purchase:email:9").first("count")), 0);
  } finally {
    await dispose();
  }
});

test("unpaid order webhook cannot start post-purchase", async () => {
  const { db, dispose } = await testDatabase();
  const env = testEnv(db);
  try {
    const payload = { id: 700, email: TEST_EMAIL, financial_status: "pending", test: true };
    const result = await processShopifyLifecycleWebhook(env, await orderRequest(payload, "shopify-event-pending-700", "orders/create"));
    assert.deepEqual(result, { accepted: true, ignored: true });
    assert.equal(Number(await db.prepare("SELECT COUNT(*) AS count FROM lifecycle_orders").first("count")), 0);
    assert.equal(Number(await db.prepare("SELECT COUNT(*) AS count FROM scheduled_lifecycle_events WHERE event_name = 'shopify.post_purchase_started'").first("count")), 0);
  } finally {
    await dispose();
  }
});

function resendWebhookRequest(payload: Record<string, unknown>, id: string, timestamp: string) {
  const body = JSON.stringify(payload);
  const key = Buffer.from("01234567890123456789012345678901");
  const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return new Request("https://worker.test/api/lifecycle/webhooks/resend", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${signature}`,
    },
    body,
  });
}

test("hard bounce suppresses locally and duplicate Resend webhook is ignored", async () => {
  const { db, dispose } = await testDatabase();
  const env = testEnv(db);
  try {
    const checkoutId = "gid://shopify/AbandonedCheckout/BOUNCE";
    await upsertCheckout(env, checkoutFixture(checkoutId), new Date("2026-09-08T02:00:00.000Z"));
    const createdAt = "2026-09-08T02:01:00.000Z";
    const payload = { type: "email.bounced", created_at: createdAt, data: { email_id: "email_bounce_1", to: [TEST_EMAIL], bounce: { type: "Permanent" } } };
    const timestamp = String(new Date(createdAt).getTime() / 1000);
    const first = await handleResendWebhook(env, resendWebhookRequest(payload, "svix-bounce-1", timestamp), new Date(createdAt));
    assert.equal(first.status, 200);
    const duplicate = await handleResendWebhook(env, resendWebhookRequest(payload, "svix-bounce-1", timestamp), new Date(createdAt));
    assert.equal((await duplicate.json()).duplicate, true);
    assert.equal(Number(await db.prepare("SELECT COUNT(*) AS count FROM email_delivery_events").first("count")), 1);
    assert.equal(Number(await db.prepare("SELECT COUNT(*) AS count FROM suppressions WHERE active = 1").first("count")), 1);
    assert.equal(await db.prepare("SELECT state FROM abandoned_checkouts WHERE shopify_checkout_id = ?").bind(checkoutId).first("state"), "SUPPRESSED");
  } finally {
    await dispose();
  }
});

test("failed Resend webhook processing is retryable instead of being lost as a duplicate", async () => {
  const { db, dispose } = await testDatabase();
  const env = testEnv(db);
  const createdAt = "2026-09-08T02:02:00.000Z";
  const payload = {
    type: "contact.updated",
    created_at: createdAt,
    data: { id: "contact_1", email: TEST_EMAIL, unsubscribed: true },
  };
  const timestamp = String(new Date(createdAt).getTime() / 1000);
  let failOnce = true;
  const failingDb = {
    prepare(query: string) {
      if (failOnce && query.includes("INSERT INTO suppressions")) {
        failOnce = false;
        throw new Error("simulated_d1_write_failure");
      }
      return db.prepare(query);
    },
    batch: db.batch.bind(db),
    exec: db.exec.bind(db),
  };
  try {
    const first = await handleResendWebhook(
      testEnv(failingDb),
      resendWebhookRequest(payload, "svix-contact-retry-1", timestamp),
      new Date(createdAt),
    );
    assert.equal(first.status, 500);
    assert.equal(
      await db.prepare("SELECT status FROM email_delivery_events WHERE webhook_event_id = ?")
        .bind("svix-contact-retry-1").first("status"),
      "FAILED",
    );

    const retry = await handleResendWebhook(
      env,
      resendWebhookRequest(payload, "svix-contact-retry-1", timestamp),
      new Date(createdAt),
    );
    assert.equal(retry.status, 200);
    assert.equal(
      await db.prepare("SELECT status FROM email_delivery_events WHERE webhook_event_id = ?")
        .bind("svix-contact-retry-1").first("status"),
      "PROCESSED",
    );
    assert.equal(Number(await db.prepare("SELECT COUNT(*) AS count FROM suppressions WHERE active = 1").first("count")), 1);
  } finally {
    await dispose();
  }
});

test("email.sent usage is counted exactly once when webhook processing retries", async () => {
  const { db, dispose } = await testDatabase();
  const env = testEnv(db);
  const createdAt = "2026-09-08T02:03:00.000Z";
  const payload = { type: "email.sent", created_at: createdAt, data: { email_id: "email_sent_retry_1", to: [TEST_EMAIL] } };
  const timestamp = String(new Date(createdAt).getTime() / 1000);
  let failOnce = true;
  const failingDb = {
    prepare(query: string) {
      if (failOnce && query.includes("SELECT id FROM automation_tracking")) {
        failOnce = false;
        throw new Error("simulated_tracking_failure_after_usage_count");
      }
      return db.prepare(query);
    },
    batch: db.batch.bind(db),
    exec: db.exec.bind(db),
  };
  try {
    const first = await handleResendWebhook(
      testEnv(failingDb),
      resendWebhookRequest(payload, "svix-sent-retry-1", timestamp),
      new Date(createdAt),
    );
    assert.equal(first.status, 500);
    const retry = await handleResendWebhook(
      env,
      resendWebhookRequest(payload, "svix-sent-retry-1", timestamp),
      new Date(createdAt),
    );
    assert.equal(retry.status, 200);
    assert.equal(
      await db.prepare(
        "SELECT emails_sent FROM lifecycle_usage_counters WHERE period_type = 'DAY' AND period_key = '2026-09-08'",
      ).first("emails_sent"),
      1,
    );
    assert.equal(Number(await db.prepare("SELECT COUNT(*) AS count FROM lifecycle_usage_event_receipts").first("count")), 1);
  } finally {
    await dispose();
  }
});

test("Resend temporary responses retry; ambiguous network failures stop automatic replay", async () => {
  const { db, dispose } = await testDatabase();
  const env = testEnv(db);
  const event = {
    event: "shopify.marketing_subscribed" as const,
    email: TEST_EMAIL,
    payload: { event_key: "evt", consent_state: "SUBSCRIBED" as const, occurred_at: "2026-09-08T02:00:00.000Z", is_test: true },
  };
  try {
    assert.equal(classifyResendResponse(503), "retry");
    assert.equal(classifyResendResponse(422), "dead");
    const retry = await sendLifecycleEvent(env, {
      idempotencyKey: "resend-retry-test",
      entityType: "identity",
      entityId: "identity-1",
      event,
      now: new Date("2026-09-08T02:00:00.000Z"),
      fetcher: async () => new Response("{}", { status: 503 }),
    });
    assert.equal(retry.status, "RETRY");
    const uncertain = await sendLifecycleEvent(env, {
      idempotencyKey: "resend-uncertain-test",
      entityType: "identity",
      entityId: "identity-1",
      event,
      now: new Date("2026-09-08T02:00:00.000Z"),
      fetcher: async () => { throw new Error("simulated connection reset"); },
    });
    assert.equal(uncertain.status, "UNCERTAIN");
    let called = false;
    const replay = await sendLifecycleEvent(env, {
      idempotencyKey: "resend-uncertain-test",
      entityType: "identity",
      entityId: "identity-1",
      event,
      fetcher: async () => { called = true; return new Response("{}", { status: 200 }); },
    });
    assert.equal(replay.status, "UNCERTAIN");
    assert.equal(called, false);
  } finally {
    await dispose();
  }
});

test("Shopify retries transient failures and overlap cursor keeps the last good state", async () => {
  const { db, dispose } = await testDatabase();
  const env = testEnv(db);
  let attempts = 0;
  const queries: string[] = [];
  const fixture = checkoutFixture("gid://shopify/AbandonedCheckout/SYNC", { updatedAt: "2026-09-08T01:50:00.000Z" });
  try {
    const first = await syncAbandonedCheckouts(env, new Date("2026-09-08T02:00:00.000Z"), {
      sleeper: async () => {},
      fetcher: async (_url, init) => {
        attempts += 1;
        if (attempts === 1) throw new Error("temporary network fault");
        queries.push(JSON.parse(String(init?.body)).variables.query);
        return Response.json({ data: { abandonedCheckouts: { nodes: [fixture], pageInfo: { hasNextPage: false, endCursor: null } } } });
      },
    });
    assert.equal(attempts, 2);
    assert.equal(first.fetched, 1);
    const lastGood = await healthValue(db, "last_shopify_sync");
    assert.equal(lastGood, "2026-09-08T02:00:00.000Z");

    await assert.rejects(() => syncAbandonedCheckouts(env, new Date("2026-09-08T02:10:00.000Z"), {
      sleeper: async () => {},
      fetcher: async (_url, init) => {
        queries.push(JSON.parse(String(init?.body)).variables.query);
        throw new Error("persistent simulated failure");
      },
    }), /shopify_network_error/);
    assert.equal(await healthValue(db, "last_shopify_sync"), lastGood);
    assert.ok(queries.some(query => query.includes("2026-09-08T01:30:00.000Z")), "30-minute overlap missing");
    assert.equal(Number(await db.prepare("SELECT COUNT(*) AS count FROM abandoned_checkouts WHERE shopify_checkout_id = ?").bind(fixture.id).first("count")), 1);
  } finally {
    await dispose();
  }
});

test("Shopify pagination cap never advances the successful cursor after a partial scan", async () => {
  const { db, dispose } = await testDatabase();
  const env = testEnv(db, { LIFECYCLE_MAX_PAGES: "1" });
  try {
    await assert.rejects(() => syncAbandonedCheckouts(env, new Date("2026-09-08T02:00:00.000Z"), {
      fetcher: async () => Response.json({
        data: {
          abandonedCheckouts: {
            nodes: [checkoutFixture("gid://shopify/AbandonedCheckout/PAGE-1")],
            pageInfo: { hasNextPage: true, endCursor: "cursor-page-2" },
          },
        },
      }),
    }), /shopify_pagination_limit_reached/);
    assert.equal(await healthValue(db, "last_shopify_sync"), null);
    assert.equal(await db.prepare("SELECT value FROM health_state WHERE key = 'shopify_sync_status'").first("value"), "shopify_pagination_limit_reached");
  } finally {
    await dispose();
  }
});

test("paid-order polling is idempotent, starts post-purchase, and prevents a later checkout schedule", async () => {
  const { db, dispose } = await testDatabase();
  const env = testEnv(db);
  const node = {
    id: "gid://shopify/Order/800",
    createdAt: "2026-09-08T02:00:00.000Z",
    updatedAt: "2026-09-08T02:01:00.000Z",
    processedAt: "2026-09-08T02:00:30.000Z",
    checkoutToken: "checkout-token-A",
    displayFinancialStatus: "PAID",
    test: true,
    email: TEST_EMAIL,
    customer: {
      id: "gid://shopify/Customer/9001",
      firstName: "הראל",
      defaultEmailAddress: {
        emailAddress: TEST_EMAIL,
        marketingState: "SUBSCRIBED",
        marketingOptInLevel: "CONFIRMED_OPT_IN",
        marketingUpdatedAt: "2026-09-08T01:59:00.000Z",
        validFormat: true,
      },
    },
    lineItems: {
      nodes: [{
        id: "gid://shopify/LineItem/1",
        title: "NOVAHAIR",
        variantTitle: "2 בקבוקים / חום כהה",
        sku: "NOVASALE-2",
        quantity: 2,
        image: null,
      }],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
    currentTotalPriceSet: { presentmentMoney: { amount: "189.00", currencyCode: "ILS" } },
    shippingAddress: {
      country: "Israel",
      countryCode: "IL",
      countryCodeV2: "IL",
    },
  };
  const fetcher: typeof fetch = async () => Response.json({
    data: { orders: { nodes: [node], pageInfo: { hasNextPage: false, endCursor: null } } },
  });
  try {
    const correlatedCheckoutId = "gid://shopify/AbandonedCheckout/TOKEN-A";
    await upsertCheckout(env, checkoutFixture(correlatedCheckoutId, {
      createdAt: "2026-09-08T01:59:30.000Z",
      abandonedCheckoutUrl: "https://jacobfelipe.myshopify.com/checkouts/checkout-token-A/recover?key=sensitive-token&locale=he",
    }), new Date("2026-09-08T02:00:00.000Z"));
    const first = await syncPaidOrders(env, new Date("2026-09-08T02:05:00.000Z"), { fetcher });
    const duplicate = await syncPaidOrders(env, new Date("2026-09-08T02:10:00.000Z"), { fetcher });
    assert.equal(first.processed, 1);
    assert.equal(duplicate.processed, 0);
    assert.equal(Number(await db.prepare("SELECT COUNT(*) AS count FROM lifecycle_orders").first("count")), 1);
    assert.equal(
      await db.prepare("SELECT shopify_checkout_id FROM lifecycle_orders WHERE shopify_order_id = ?").bind("gid://shopify/Order/800").first("shopify_checkout_id"),
      correlatedCheckoutId,
    );
    assert.equal(Number(await db.prepare("SELECT COUNT(*) AS count FROM scheduled_lifecycle_events WHERE event_name = 'shopify.post_purchase_started'").first("count")), 2);

    const checkoutId = "gid://shopify/AbandonedCheckout/AFTER-ORDER";
    await upsertCheckout(env, checkoutFixture(checkoutId, { createdAt: "2026-09-08T01:59:30.000Z" }), new Date("2026-09-08T02:11:00.000Z"));
    assert.equal(await db.prepare("SELECT state FROM abandoned_checkouts WHERE shopify_checkout_id = ?").bind(checkoutId).first("state"), "PURCHASED");
    assert.equal(Number(await db.prepare("SELECT COUNT(*) AS count FROM scheduled_lifecycle_events WHERE entity_id = ? AND event_name = 'shopify.checkout_abandoned'").bind(checkoutId).first("count")), 0);
  } finally {
    await dispose();
  }
});

test("Shopify consent polling suppresses locally and synchronizes the Resend contact monotonically", async () => {
  const { db, dispose } = await testDatabase();
  const env = testEnv(db);
  const checkoutId = "gid://shopify/AbandonedCheckout/CONSENT-POLL";
  try {
    await upsertCheckout(env, checkoutFixture(checkoutId), new Date("2026-09-08T02:00:00.000Z"));
    const customer = {
      id: "gid://shopify/Customer/9001",
      firstName: "הראל",
      updatedAt: "2026-09-08T02:04:00.000Z",
      defaultEmailAddress: {
        emailAddress: TEST_EMAIL,
        marketingState: "UNSUBSCRIBED",
        marketingOptInLevel: "CONFIRMED_OPT_IN",
        marketingUpdatedAt: "2026-09-08T02:04:00.000Z",
        validFormat: true,
      },
    };
    const result = await syncCustomerConsent(env, new Date("2026-09-08T02:05:00.000Z"), {
      fetcher: async () => Response.json({
        data: { customers: { nodes: [customer], pageInfo: { hasNextPage: false, endCursor: null } } },
      }),
    });
    assert.equal(result.unsubscribed, 1);
    assert.equal(await db.prepare("SELECT state FROM abandoned_checkouts WHERE shopify_checkout_id = ?").bind(checkoutId).first("state"), "SUPPRESSED");
    assert.equal(Number(await db.prepare("SELECT COUNT(*) AS count FROM resend_contact_updates WHERE status = 'PENDING'").first("count")), 1);

    let calls = 0;
    const contactResult = await dispatchResendContactUpdates(env, new Date("2026-09-08T02:05:01.000Z"), async (url, init) => {
      calls += 1;
      assert.match(String(url), /\/contacts\/merchant-test%40example\.com$/);
      assert.deepEqual(JSON.parse(String(init?.body)), { unsubscribed: true });
      return Response.json({ object: "contact", id: "contact_1" });
    });
    assert.deepEqual(contactResult, { attempted: 1, sent: 1, failed: 0 });
    const duplicate = await dispatchResendContactUpdates(env, new Date("2026-09-08T02:06:00.000Z"), async () => {
      calls += 1;
      return Response.json({});
    });
    assert.equal(duplicate.attempted, 0);
    assert.equal(calls, 1);
  } finally {
    await dispose();
  }
});

test("replenishment schedule varies by purchased bundle/quantity", () => {
  assert.equal(replenishmentOffsetDays(null, 1), 35);
  assert.equal(replenishmentOffsetDays("2 בקבוקים", 2), 60);
  assert.equal(replenishmentOffsetDays("4 bottles", 4), 105);
  assert.equal(replenishmentOffsetDays("6 pack", 6), 150);
});
