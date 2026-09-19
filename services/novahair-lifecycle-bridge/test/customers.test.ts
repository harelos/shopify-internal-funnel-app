import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "../src/worker";
import { hashEmail } from "../src/crypto";
import {
  engagementScore,
  recomputeEngagementScores,
  syncCustomerBackfill,
  syncCustomerProducts,
  touchCustomerConsent,
  touchCustomerOnEmailEvent,
  touchCustomerOnOrder,
  upsertCustomerFromShopify,
} from "../src/customers";
import { lifecycleConfig } from "../src/config";
import { setHealth } from "../src/db";
import { TEST_EMAIL, testDatabase, testEnv } from "./helpers/d1";

const context = { waitUntil() {} };
const NOW = new Date("2026-09-19T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

test("engagement score is bounded and each signal caps independently", () => {
  // Nothing known → 0
  assert.equal(engagementScore({ lastOrderAt: null, orderCount: 0, lastOpenAt: null, lastClickAt: null }, NOW), 0);
  // Recent order, one purchase, no email → 40 + 10
  assert.equal(engagementScore({ lastOrderAt: daysAgo(5), orderCount: 1, lastOpenAt: null, lastClickAt: null }, NOW), 50);
  // Max everything → capped at 100
  assert.equal(engagementScore({ lastOrderAt: daysAgo(1), orderCount: 9, lastOpenAt: daysAgo(1), lastClickAt: daysAgo(1) }, NOW), 100);
  // Click beats open; both within 30d only counts click
  assert.equal(engagementScore({ lastOrderAt: null, orderCount: 0, lastOpenAt: daysAgo(2), lastClickAt: daysAgo(2) }, NOW), 30);
  // Old open (60d) → 10
  assert.equal(engagementScore({ lastOrderAt: null, orderCount: 0, lastOpenAt: daysAgo(60), lastClickAt: null }, NOW), 10);
  // Recency boundaries
  assert.equal(engagementScore({ lastOrderAt: daysAgo(31), orderCount: 0, lastOpenAt: null, lastClickAt: null }, NOW), 30);
  assert.equal(engagementScore({ lastOrderAt: daysAgo(91), orderCount: 0, lastOpenAt: null, lastClickAt: null }, NOW), 20);
  assert.equal(engagementScore({ lastOrderAt: daysAgo(181), orderCount: 0, lastOpenAt: null, lastClickAt: null }, NOW), 10);
  assert.equal(engagementScore({ lastOrderAt: daysAgo(366), orderCount: 0, lastOpenAt: null, lastClickAt: null }, NOW), 0);
});

test("a Shopify customer node becomes one customer row, and re-syncing converges rather than duplicating", async () => {
  const { db, dispose } = await testDatabase();
  const env = testEnv(db, { LIFECYCLE_MODE: "production" });
  try {
    const node = {
      id: "gid://shopify/Customer/1",
      firstName: "רונית",
      updatedAt: NOW.toISOString(),
      createdAt: daysAgo(400),
      numberOfOrders: 2,
      amountSpent: { amount: "428.00", currencyCode: "ILS" },
      lastOrder: { createdAt: daysAgo(20) },
      defaultEmailAddress: {
        emailAddress: "Ronit@Example.com",
        marketingState: "NOT_SUBSCRIBED" as const,
        marketingOptInLevel: null,
        marketingUpdatedAt: daysAgo(400),
        validFormat: true,
      },
    };
    assert.equal(await upsertCustomerFromShopify(env, node, NOW, "SHOPIFY_BACKFILL"), true);
    // Second pass with a newer, larger aggregate must update in place.
    node.numberOfOrders = 3;
    node.amountSpent = { amount: "617.00", currencyCode: "ILS" };
    node.lastOrder = { createdAt: daysAgo(2) };
    assert.equal(await upsertCustomerFromShopify(env, node, NOW, "SHOPIFY_SYNC"), true);

    const rows = await db.prepare("SELECT * FROM customers").all<Record<string, unknown>>();
    assert.equal(rows.results?.length, 1);
    const row = rows.results![0];
    assert.equal(row.email, "ronit@example.com");
    assert.equal(row.email_hash, await hashEmail("ronit@example.com", lifecycleConfig(env).hashKey));
    assert.equal(row.consent_state, "NOT_SUBSCRIBED");
    assert.equal(Number(row.order_count), 3);
    assert.equal(Number(row.lifetime_value), 617);
    assert.equal(row.last_order_at, daysAgo(2));
    assert.equal(row.customer_since, daysAgo(400));
  } finally {
    await dispose();
  }
});

test("invalid or out-of-mode emails never create a customer", async () => {
  const { db, dispose } = await testDatabase();
  const env = testEnv(db, { LIFECYCLE_MODE: "test" });
  try {
    const base = { id: "gid://shopify/Customer/9", firstName: null, updatedAt: NOW.toISOString(), numberOfOrders: 0 };
    assert.equal(await upsertCustomerFromShopify(env, {
      ...base,
      defaultEmailAddress: { emailAddress: "not an email", marketingState: "SUBSCRIBED", marketingOptInLevel: null, marketingUpdatedAt: null, validFormat: false },
    }, NOW, "SHOPIFY_SYNC"), false);
    // Test mode only admits the configured test address.
    assert.equal(await upsertCustomerFromShopify(env, {
      ...base,
      defaultEmailAddress: { emailAddress: "someone@else.com", marketingState: "SUBSCRIBED", marketingOptInLevel: null, marketingUpdatedAt: null, validFormat: true },
    }, NOW, "SHOPIFY_SYNC"), false);
    assert.equal(await upsertCustomerFromShopify(env, {
      ...base,
      defaultEmailAddress: { emailAddress: TEST_EMAIL, marketingState: "SUBSCRIBED", marketingOptInLevel: null, marketingUpdatedAt: null, validFormat: true },
    }, NOW, "SHOPIFY_SYNC"), true);
    assert.equal(Number(await db.prepare("SELECT COUNT(*) n FROM customers").first("n")), 1);
  } finally {
    await dispose();
  }
});

test("a paid order increments the row, merges products, and flags NovaHair buyers", async () => {
  const { db, dispose } = await testDatabase();
  const env = testEnv(db, { LIFECYCLE_MODE: "production" });
  try {
    const email = "buyer@example.com";
    const emailHash = await hashEmail(email, lifecycleConfig(env).hashKey);
    const order = (completedAt: string, total: number, handles: string[]) => touchCustomerOnOrder(env, {
      email, emailHash, shopifyCustomerId: "gid://shopify/Customer/5", firstName: "דנה",
      consentState: "NOT_SUBSCRIBED", completedAt, total, currency: "ILS", productHandles: handles,
    }, NOW);

    await order(daysAgo(30), 189, ["hair-gloss"]);
    await order(daysAgo(3), 239, ["novahair-funnel-internal", "argan-mask"]);

    const row = await db.prepare("SELECT * FROM customers WHERE email_hash = ?").bind(emailHash).first<Record<string, unknown>>();
    assert.ok(row);
    assert.equal(Number(row.order_count), 2);
    assert.equal(Number(row.lifetime_value), 428);
    assert.equal(row.first_order_at, daysAgo(30));
    assert.equal(row.last_order_at, daysAgo(3));
    assert.deepEqual(JSON.parse(String(row.products_json)), ["argan-mask", "hair-gloss", "novahair-funnel-internal"]);
    assert.equal(Number(row.novahair_buyer), 1);
    assert.equal(row.source, "SHOPIFY_WEBHOOK");
  } finally {
    await dispose();
  }
});

test("email events bump counters only for known customers, and consent sync updates the cache", async () => {
  const { db, dispose } = await testDatabase();
  const env = testEnv(db, { LIFECYCLE_MODE: "production" });
  try {
    const email = "reader@example.com";
    const emailHash = await hashEmail(email, lifecycleConfig(env).hashKey);
    await touchCustomerOnOrder(env, {
      email, emailHash, shopifyCustomerId: null, firstName: null, consentState: "SUBSCRIBED",
      completedAt: daysAgo(10), total: 189, currency: "ILS", productHandles: [],
    }, NOW);

    await touchCustomerOnEmailEvent(env, emailHash, "email.sent", daysAgo(5), NOW);
    await touchCustomerOnEmailEvent(env, emailHash, "email.opened", daysAgo(4), NOW);
    await touchCustomerOnEmailEvent(env, emailHash, "email.opened", daysAgo(2), NOW);
    await touchCustomerOnEmailEvent(env, emailHash, "email.clicked", daysAgo(2), NOW);
    // Unknown recipient: silently ignored, no row created.
    await touchCustomerOnEmailEvent(env, "no-such-hash", "email.opened", daysAgo(1), NOW);

    let row = await db.prepare("SELECT * FROM customers WHERE email_hash = ?").bind(emailHash).first<Record<string, unknown>>();
    assert.equal(Number(row!.emails_sent), 1);
    assert.equal(Number(row!.emails_opened), 2);
    assert.equal(Number(row!.emails_clicked), 1);
    assert.equal(row!.last_open_at, daysAgo(2));
    assert.equal(row!.last_click_at, daysAgo(2));
    assert.equal(Number(await db.prepare("SELECT COUNT(*) n FROM customers").first("n")), 1);

    await touchCustomerConsent(env, emailHash, "UNSUBSCRIBED", daysAgo(1), NOW);
    row = await db.prepare("SELECT consent_state, consent_updated_at FROM customers WHERE email_hash = ?").bind(emailHash).first<Record<string, unknown>>();
    assert.equal(row!.consent_state, "UNSUBSCRIBED");
    assert.equal(row!.consent_updated_at, daysAgo(1));

    // Score refresh reads the counters: order 10d ago (40) + 1 order (10) + click 2d ago (30) = 80
    const changed = await recomputeEngagementScores(env, NOW);
    assert.equal(changed, 1);
    row = await db.prepare("SELECT engagement_score FROM customers WHERE email_hash = ?").bind(emailHash).first<Record<string, unknown>>();
    assert.equal(Number(row!.engagement_score), 80);
  } finally {
    await dispose();
  }
});

test("backfill walks every page across ticks, then marks itself done and stops calling Shopify", async () => {
  const { db, dispose } = await testDatabase();
  const env = testEnv(db, { LIFECYCLE_MODE: "production", LIFECYCLE_MAX_PAGES: "1" });
  try {
    const node = (i: number) => ({
      id: `gid://shopify/Customer/${i}`, firstName: null, updatedAt: NOW.toISOString(), createdAt: daysAgo(100),
      numberOfOrders: 1, amountSpent: { amount: "189", currencyCode: "ILS" }, lastOrder: { createdAt: daysAgo(50) },
      defaultEmailAddress: { emailAddress: `c${i}@example.com`, marketingState: "SUBSCRIBED" as const, marketingOptInLevel: null, marketingUpdatedAt: null, validFormat: true },
    });
    const pages = [
      { customers: { nodes: [node(1), node(2)], pageInfo: { hasNextPage: true, endCursor: "c2" } } },
      { customers: { nodes: [node(3)], pageInfo: { hasNextPage: false, endCursor: "c3" } } },
    ];
    let calls = 0;
    const graphql = async <T>(_e: unknown, _q: string, vars: Record<string, unknown>): Promise<T> => {
      calls += 1;
      const idx = vars.after === "c2" ? 1 : 0;
      return pages[idx] as T;
    };

    // Tick 1: one page (maxPages=1), cursor persisted, not done.
    let r = await syncCustomerBackfill(env, NOW, graphql);
    assert.deepEqual(r, { pages: 1, upserted: 2, done: false });
    assert.equal(await db.prepare("SELECT value FROM health_state WHERE key='customers_backfill_cursor'").first("value"), "c2");

    // Tick 2: resumes from cursor, finishes.
    r = await syncCustomerBackfill(env, NOW, graphql);
    assert.deepEqual(r, { pages: 1, upserted: 1, done: true });
    assert.equal(await db.prepare("SELECT value FROM health_state WHERE key='customers_backfill_done'").first("value"), "true");
    assert.equal(Number(await db.prepare("SELECT COUNT(*) n FROM customers").first("n")), 3);

    // Tick 3: no-op, Shopify not called.
    const before = calls;
    r = await syncCustomerBackfill(env, NOW, graphql);
    assert.deepEqual(r, { pages: 0, upserted: 0, done: true });
    assert.equal(calls, before);
  } finally {
    await dispose();
  }
});

test("product history joins orders to customers by Shopify id without needing PII", async () => {
  const { db, dispose } = await testDatabase();
  const env = testEnv(db, { LIFECYCLE_MODE: "production", LIFECYCLE_MAX_PAGES: "5" });
  try {
    await upsertCustomerFromShopify(env, {
      id: "gid://shopify/Customer/7", firstName: null, updatedAt: NOW.toISOString(), numberOfOrders: 1,
      defaultEmailAddress: { emailAddress: "p@example.com", marketingState: "SUBSCRIBED", marketingOptInLevel: null, marketingUpdatedAt: null, validFormat: true },
    }, NOW, "SHOPIFY_BACKFILL");

    let calls = 0;
    const graphql = async <T>(): Promise<T> => {
      calls += 1;
      return {
        orders: {
          nodes: [
            { id: "gid://shopify/Order/1", customer: { id: "gid://shopify/Customer/7" }, lineItems: { nodes: [{ product: { handle: "NovaSale-4" } }, { product: null }] } },
            { id: "gid://shopify/Order/2", customer: { id: "gid://shopify/Customer/7" }, lineItems: { nodes: [{ product: { handle: "hair-gloss" } }] } },
            { id: "gid://shopify/Order/3", customer: null, lineItems: { nodes: [{ product: { handle: "ignored" } }] } },
            { id: "gid://shopify/Order/4", customer: { id: "gid://shopify/Customer/404" }, lineItems: { nodes: [{ product: { handle: "unknown-customer" } }] } },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      } as T;
    };

    // Until the customer backfill has finished, the products sync must not
    // touch Shopify: an order whose customer row is missing would be skipped
    // for good once the cursor moved past it.
    let r = await syncCustomerProducts(env, NOW, graphql);
    assert.deepEqual(r, { pages: 0, customersTouched: 0, done: false });
    assert.equal(calls, 0);
    assert.match(String(await db.prepare("SELECT value FROM health_state WHERE key='customers_products_status'").first("value")), /waitingFor/);

    await setHealth(db, "customers_backfill_done", "true", "OK", NOW.toISOString());
    r = await syncCustomerProducts(env, NOW, graphql);
    assert.deepEqual(r, { pages: 1, customersTouched: 1, done: true });
    assert.equal(calls, 1);
    const row = await db.prepare("SELECT products_json, novahair_buyer FROM customers WHERE shopify_customer_id = ?").bind("gid://shopify/Customer/7").first<Record<string, unknown>>();
    assert.deepEqual(JSON.parse(String(row!.products_json)), ["hair-gloss", "novasale-4"]);
    assert.equal(Number(row!.novahair_buyer), 1);
  } finally {
    await dispose();
  }
});

test("admin customers endpoint is hidden without auth and never returns a raw email", async () => {
  const { db, dispose } = await testDatabase();
  const env = testEnv(db, { LIFECYCLE_MODE: "production" });
  try {
    const mk = async (email: string, consent: "SUBSCRIBED" | "UNSUBSCRIBED" | "NOT_SUBSCRIBED", handles: string[], ago: number) =>
      touchCustomerOnOrder(env, {
        email, emailHash: await hashEmail(email, lifecycleConfig(env).hashKey), shopifyCustomerId: null, firstName: null,
        consentState: consent, completedAt: daysAgo(ago), total: 189, currency: "ILS", productHandles: handles,
      }, NOW);
    await mk("a@example.com", "SUBSCRIBED", ["novahair-funnel-internal"], 5);
    await mk("b@example.com", "NOT_SUBSCRIBED", ["hair-gloss"], 200);
    await mk("c@example.com", "UNSUBSCRIBED", [], 10);
    await recomputeEngagementScores(env, NOW);

    const hidden = await worker.fetch(new Request("https://worker.test/api/lifecycle/admin/customers"), env, context);
    assert.equal(hidden.status, 404);

    const headers = { Authorization: "Bearer test_admin_token" };
    const all = await (await worker.fetch(new Request("https://worker.test/api/lifecycle/admin/customers", { headers }), env, context)).json() as any;
    assert.equal(all.total, 3);
    assert.equal(all.summary.marketingReachable, 2);
    assert.deepEqual(all.summary.byConsent, { SUBSCRIBED: 1, NOT_SUBSCRIBED: 1, UNSUBSCRIBED: 1 });
    for (const row of all.rows) {
      assert.match(row.emailMasked, /^[a-z]{1}\*\*\*@example\.com$/);
      assert.equal("email" in row, false);
    }
    // Highest score first: a@ (5d, 1 order, nova) = 50
    assert.equal(all.rows[0].emailMasked, "a***@example.com");
    assert.equal(all.rows[0].score, 50);
    assert.equal(all.rows[0].novahair, true);

    const nova = await (await worker.fetch(new Request("https://worker.test/api/lifecycle/admin/customers?novahair=1", { headers }), env, context)).json() as any;
    assert.equal(nova.total, 1);

    const hot = await (await worker.fetch(new Request("https://worker.test/api/lifecycle/admin/customers?min_score=40", { headers }), env, context)).json() as any;
    assert.equal(hot.total, 2); // a@ (50) and c@ (10d → 40 + 10 = 50)
  } finally {
    await dispose();
  }
});
