import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "../src/worker";
import { TEST_EMAIL, testDatabase, testEnv } from "./helpers/d1";

const context = { waitUntil() {} };
const from = "2026-09-08T19:01:36.122Z";
const to = "2026-09-09T19:01:36.122Z";

test("private analytics exposes all 39 emails, performance, and revenue without PII", async () => {
  const { db, dispose } = await testDatabase();
  const env = testEnv(db, { LIFECYCLE_MODE: "production", LIFECYCLE_ACTIVATED_AT: from });
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO resend_resources
          (resource_type, name, external_id, status, created_at, updated_at)
         VALUES ('AUTOMATION', 'NovaHair — Abandoned Checkout — D1 Correlated', 'auto-checkout', 'ENABLED', ?, ?)`,
      ).bind(from, from),
      db.prepare(
        `INSERT INTO resend_resources
          (resource_type, name, external_id, status, created_at, updated_at)
         VALUES ('TEMPLATE', 'novahair_abandoned_checkout_e01', 'template-checkout-e01', 'PUBLISHED', ?, ?)`,
      ).bind(from, from),
      db.prepare(
        `INSERT INTO automation_tracking (
           idempotency_key, flow, email_number, entity_type, entity_id, recipient_hash,
           template_alias, template_id, automation_id, resend_email_id, status,
           scheduled_at, triggered_at, sent_at, clicked_at, utm_campaign, utm_content,
           created_at, updated_at
         ) VALUES (
           'tracking-1', 'abandoned_checkout', 1, 'checkout', 'checkout-1', 'recipient-hash',
           'novahair_abandoned_checkout_e01', 'template-checkout-e01', 'auto-checkout',
           'email-1', 'CLICKED', ?, ?, ?, ?, 'novahair_abandoned_checkout',
           'e01_checkout_reminder', ?, ?
         )`,
      ).bind(from, from, from, "2026-09-08T20:00:00.000Z", from, "2026-09-08T20:00:00.000Z"),
      db.prepare(
        `INSERT INTO abandoned_checkouts (
           shopify_checkout_id, shop_domain, email, email_hash, checkout_url,
           created_at, updated_at, first_seen_at, last_seen_at, consent_state,
           state, payload_hash
         ) VALUES ('checkout-1', 'jacobfelipe.myshopify.com', ?, 'recipient-hash',
                   'encrypted-recovery-url', ?, ?, ?, ?, 'SUBSCRIBED', 'ABANDONED', 'checkout-hash')`,
      ).bind(TEST_EMAIL, from, from, from, from),
      ...["sent", "delivered", "opened", "clicked"].map((event) => db.prepare(
        `INSERT INTO email_delivery_events (
           webhook_event_id, event_type, resend_email_id, template_id, automation_id,
           recipient_hash, occurred_at, received_at, payload_hash, status, processed_at
         ) VALUES (?, ?, 'email-1', 'template-checkout-e01', 'auto-checkout',
                   'recipient-hash', ?, ?, 'payload-hash', 'PROCESSED', ?)`,
      ).bind(`webhook-${event}`, `email.${event}`, "2026-09-08T20:00:00.000Z", "2026-09-08T20:00:00.000Z", "2026-09-08T20:00:00.000Z")),
      db.prepare(
        `INSERT INTO lifecycle_orders (
           shopify_order_id, shopify_checkout_id, email, email_hash, consent_state,
           completed_at, quantity, total, currency, repeat_purchase, payload_hash,
           created_at, updated_at
         ) VALUES ('order-1', 'checkout-1', ?, 'recipient-hash', 'SUBSCRIBED',
                   '2026-09-08T21:00:00.000Z', 2, 189, 'ILS', 0, 'order-hash', ?, ?)`,
      ).bind(TEST_EMAIL, from, from),
      db.prepare(
        `INSERT INTO lifecycle_attribution (
           attribution_key, source, flow, email_number, shopify_checkout_id,
           utm_campaign, utm_content, clicked_at, entity_type, entity_id,
           recipient_hash, created_at, updated_at
         ) VALUES ('click-1', 'FIRST_PARTY_CLICK', 'abandoned_checkout', 1,
                   'checkout-1', 'novahair_abandoned_checkout', 'e01_checkout_reminder',
                   '2026-09-08T20:00:00.000Z', 'checkout', 'checkout-1',
                   'recipient-hash', ?, ?)`,
      ).bind(from, from),
    ]);

    const hidden = await worker.fetch(
      new Request("https://worker.test/api/lifecycle/admin/analytics"),
      env,
      context,
    );
    assert.equal(hidden.status, 404);

    const headers = { Authorization: "Bearer test_admin_token" };
    const catalogResponse = await worker.fetch(
      new Request("https://worker.test/api/lifecycle/admin/flows", { headers }),
      env,
      context,
    );
    assert.equal(catalogResponse.status, 200);
    const catalog = await catalogResponse.json() as {
      totalFlows: number;
      totalEmails: number;
      flows: Array<{ emails: Array<{ body: string[] }> }>;
    };
    assert.equal(catalog.totalFlows, 6);
    assert.equal(catalog.totalEmails, 39);
    assert.ok(catalog.flows.every(flow => flow.emails.every(email => email.body.length > 0)));

    const analyticsResponse = await worker.fetch(
      new Request(`https://worker.test/api/lifecycle/admin/analytics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { headers }),
      env,
      context,
    );
    assert.equal(analyticsResponse.status, 200);
    const analytics = await analyticsResponse.json() as {
      totals: {
        shopifyOrders: number;
        shopifyRevenueByCurrency: Record<string, number>;
        firstPartyAttributedOrders: number;
      };
      flows: Array<{ flow: string; emails: Array<{ number: number; metrics: Record<string, unknown> }> }>;
    };
    assert.equal(analytics.totals.shopifyOrders, 1);
    assert.equal(analytics.totals.shopifyRevenueByCurrency.ILS, 189);
    assert.equal(analytics.totals.firstPartyAttributedOrders, 1);
    const checkout = analytics.flows.find(flow => flow.flow === "abandoned_checkout");
    const email = checkout?.emails.find(item => item.number === 1);
    assert.equal(email?.metrics.sent, 1);
    assert.equal(email?.metrics.delivered, 1);
    assert.equal(email?.metrics.opened, 1);
    assert.equal(email?.metrics.providerClicked, 1);
    assert.equal(email?.metrics.firstPartyClicked, 1);
    assert.equal(email?.metrics.attributedOrders, 1);
    const serialized = JSON.stringify({ catalog, analytics });
    assert.doesNotMatch(serialized, new RegExp(TEST_EMAIL.replace(".", "\\."), "i"));
    assert.doesNotMatch(serialized, /recipient-hash|checkout-1|order-1/i);

    const audienceResponse = await worker.fetch(
      new Request("https://worker.test/api/lifecycle/admin/audience", { headers }),
      env,
      context,
    );
    assert.equal(audienceResponse.status, 200);
    const audience = await audienceResponse.json() as {
      contactTracking: { resendContactTags: string; unsubscribeAndSuppressionSync: string };
      messages: Array<{ recipient: string; flow: string; emailNumber: number; deliveredAt: string | null; openedAt: string | null; providerClickedAt: string | null }>;
      pagination: { hasMore: boolean; nextOffset: number | null };
      privacy: { recoveryUrlReturned: boolean; checkoutTokenReturned: boolean };
    };
    assert.equal(audience.contactTracking.resendContactTags, "not_configured");
    assert.equal(audience.contactTracking.unsubscribeAndSuppressionSync, "enabled");
    assert.equal(audience.privacy.recoveryUrlReturned, false);
    assert.equal(audience.privacy.checkoutTokenReturned, false);
    assert.equal(audience.messages.length, 1);
    assert.equal(audience.messages[0]?.recipient, TEST_EMAIL);
    assert.equal(audience.messages[0]?.flow, "abandoned_checkout");
    assert.equal(audience.messages[0]?.emailNumber, 1);
    assert.ok(audience.messages[0]?.deliveredAt);
    assert.ok(audience.messages[0]?.openedAt);
    assert.ok(audience.messages[0]?.providerClickedAt);
    assert.equal(audience.pagination.hasMore, false);
    assert.equal(audience.pagination.nextOffset, null);

    const filteredResponse = await worker.fetch(
      new Request("https://worker.test/api/lifecycle/admin/audience?flow=abandoned_checkout&emailNumber=1&limit=1", { headers }),
      env,
      context,
    );
    assert.equal(filteredResponse.status, 200);
    const filtered = await filteredResponse.json() as { messages: unknown[] };
    assert.equal(filtered.messages.length, 1);

    const invalidFilter = await worker.fetch(
      new Request("https://worker.test/api/lifecycle/admin/audience?flow=not-a-flow", { headers }),
      env,
      context,
    );
    assert.equal(invalidFilter.status, 400);
  } finally {
    await dispose();
  }
});
