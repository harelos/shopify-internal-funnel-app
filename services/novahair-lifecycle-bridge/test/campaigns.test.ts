import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "../src/worker";
import {
  applyUnsubscribe,
  approveCampaign,
  assertAllowedCtaUrl,
  campaignBudget,
  campaignReport,
  createCampaign,
  dispatchDueCampaigns,
  ensureUnsubscribeToken,
  setCampaignStatus,
} from "../src/campaigns";
import { upsertCustomerFromShopify } from "../src/customers";
import { compileSegment, countSegment, parseSegmentFilter, previewSegment, saveSegment } from "../src/segments";
import { hashEmail } from "../src/crypto";
import { isoNow } from "../src/db";
import { testDatabase, testEnv } from "./helpers/d1";

const context = { waitUntil() {} };
const NOW = new Date("2026-09-19T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

function productionEnv(db: unknown, overrides: Record<string, unknown> = {}) {
  return testEnv(db, { LIFECYCLE_MODE: "production", ...overrides });
}

async function addCustomer(
  env: ReturnType<typeof testEnv>,
  options: {
    email: string;
    id?: string;
    consent?: string;
    orders?: number;
    spent?: number;
    lastOrder?: string | null;
    firstName?: string | null;
  },
) {
  await upsertCustomerFromShopify(env as never, {
    id: options.id ?? `gid://shopify/Customer/${options.email}`,
    firstName: options.firstName ?? null,
    updatedAt: NOW.toISOString(),
    numberOfOrders: options.orders ?? 0,
    amountSpent: { amount: String(options.spent ?? 0), currencyCode: "ILS" },
    lastOrder: options.lastOrder ? { createdAt: options.lastOrder } : null,
    defaultEmailAddress: {
      emailAddress: options.email,
      marketingState: options.consent ?? "SUBSCRIBED",
      marketingOptInLevel: "SINGLE_OPT_IN",
      marketingUpdatedAt: NOW.toISOString(),
      validFormat: true,
    },
  }, NOW, "SHOPIFY_BACKFILL");
}

function okFetcher(id = "resend-email-1"): typeof fetch {
  return (async () => new Response(JSON.stringify({ id }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })) as unknown as typeof fetch;
}

const HTML = "<p>שלום {{FIRST_NAME}}</p><a href=\"{{CTA_URL}}\">לצפייה</a><a href=\"{{UNSUBSCRIBE_URL}}\">הסרה</a>";

test("a segment filter is an allowlist: unknown keys and impossible ranges are rejected", () => {
  assert.deepEqual(parseSegmentFilter({ minOrders: 2, novahairBuyer: true }), { minOrders: 2, novahairBuyer: true });

  // Raw SQL, unknown keys and out-of-range values can only ever be rejected.
  assert.throws(() => parseSegmentFilter({ "1=1; DROP TABLE customers": 1 }), /segment_filter_invalid_unknown_key/);
  assert.throws(() => parseSegmentFilter({ minScore: 101 }), /segment_filter_invalid_minScore/);
  assert.throws(() => parseSegmentFilter({ minOrders: 5, maxOrders: 2 }), /segment_filter_invalid_orders_range/);
  assert.throws(() => parseSegmentFilter({ neverOrdered: true, minOrders: 1 }), /never_ordered_conflict/);
  assert.throws(() => parseSegmentFilter({ productHandleAny: ["nova sale"] }), /productHandleAny/);
  assert.throws(() => parseSegmentFilter({ consent: ["UNSUBSCRIBED"] }), /segment_filter_invalid_consent/);
  assert.throws(() => parseSegmentFilter("everyone"), /segment_filter_invalid_shape/);

  // Whatever the filter says, the compiled SQL always carries the three
  // non-negotiable rules.
  const compiled = compileSegment(parseSegmentFilter({}), NOW);
  assert.match(compiled.where, /c\.email IS NOT NULL/);
  assert.match(compiled.where, /c\.consent_state IN \(\?, \?\)/);
  assert.match(compiled.where, /NOT EXISTS \(SELECT 1 FROM suppressions/);
  assert.deepEqual(compiled.binds, ["SUBSCRIBED", "NOT_SUBSCRIBED"]);
});

test("a segment counts only reachable, unsuppressed people and masks the sample", async () => {
  const { db, dispose } = await testDatabase();
  const env = productionEnv(db);
  try {
    await addCustomer(env, { email: "sub@example.com", orders: 2, spent: 400, lastOrder: daysAgo(10), firstName: "דנה" });
    await addCustomer(env, { email: "never@example.com", consent: "NOT_SUBSCRIBED", orders: 1, lastOrder: daysAgo(200) });
    await addCustomer(env, { email: "out@example.com", consent: "UNSUBSCRIBED", orders: 3 });
    await addCustomer(env, { email: "bounced@example.com", orders: 1, lastOrder: daysAgo(5) });

    const suppressed = await hashEmail("bounced@example.com", "test-hash-key-that-is-never-used-in-production");
    await db.prepare(
      `INSERT INTO suppressions (email_hash, source, reason, occurred_at, active, created_at, updated_at)
       VALUES (?, 'RESEND', 'bounce', ?, 1, ?, ?)`,
    ).bind(suppressed, isoNow(NOW), isoNow(NOW), isoNow(NOW)).run();

    // UNSUBSCRIBED is excluded by consent, bounced by suppression.
    assert.equal(await countSegment(env as never, parseSegmentFilter({}), NOW), 2);
    assert.equal(await countSegment(env as never, parseSegmentFilter({ consent: ["SUBSCRIBED"] }), NOW), 1);
    assert.equal(await countSegment(env as never, parseSegmentFilter({ orderedWithinDays: 30 }), NOW), 1);
    assert.equal(await countSegment(env as never, parseSegmentFilter({ lastOrderOlderThanDays: 90 }), NOW), 1);
    assert.equal(await countSegment(env as never, parseSegmentFilter({ minLifetimeValue: 300 }), NOW), 1);

    const preview = await previewSegment(env as never, parseSegmentFilter({ consent: ["SUBSCRIBED"] }), NOW);
    assert.equal(preview.count, 1);
    assert.equal(preview.sample[0]?.email, "su***@example.com");
    assert.equal(preview.sample[0]?.firstName, "דנה");

    const saved = await saveSegment(env as never, {
      name: "Recent NovaHair buyers",
      filter: { orderedWithinDays: 30 },
      createdBy: "AGENT",
    }, NOW);
    assert.equal(saved.segmentId, "seg_recent-novahair-buyers");
    assert.equal(saved.count, 1);
  } finally {
    await dispose();
  }
});

test("a marketing campaign cannot be created without a way out or with an off-site link", async () => {
  const { db, dispose } = await testDatabase();
  const env = productionEnv(db);
  try {
    await addCustomer(env, { email: "a@example.com" });
    await saveSegment(env as never, { name: "All", filter: {}, createdBy: "AGENT" }, NOW);

    await assert.rejects(
      createCampaign(env as never, {
        name: "No exit", segmentId: "seg_all", subject: "שלום",
        html: "<p>טקסט בלי קישור הסרה</p>", proposedBy: "AGENT",
      }, NOW),
      /campaign_invalid_html_missing_unsubscribe/,
    );

    await assert.rejects(
      createCampaign(env as never, {
        name: "Bad link", segmentId: "seg_all", subject: "שלום", html: HTML,
        ctaUrl: "https://evil.example.com/steal", proposedBy: "AGENT",
      }, NOW),
      /campaign_invalid_cta_url_host/,
    );

    await assert.rejects(
      createCampaign(env as never, {
        name: "Unknown segment", segmentId: "seg_missing", subject: "שלום", html: HTML,
        ctaUrl: "https://tigerbrandsglobal.com/pages/novahair", proposedBy: "AGENT",
      }, NOW),
      /campaign_invalid_segment_unknown/,
    );

    assert.equal(
      assertAllowedCtaUrl(env as never, "https://tigerbrandsglobal.com/pages/novahair"),
      "https://tigerbrandsglobal.com/pages/novahair",
    );
    assert.throws(() => assertAllowedCtaUrl(env as never, "http://tigerbrandsglobal.com/x"), /cta_url_protocol/);

    const created = await createCampaign(env as never, {
      name: "September restock", segmentId: "seg_all", subject: "חזרנו למלאי", html: HTML,
      ctaUrl: "https://tigerbrandsglobal.com/pages/novahair", proposedBy: "AGENT",
      proposalReason: "Medium brown is back in stock",
    }, NOW);
    assert.equal(created.status, "DRAFT");
    assert.equal(created.audienceEstimate, 1);
  } finally {
    await dispose();
  }
});

test("approval freezes the audience and only a draft can be approved", async () => {
  const { db, dispose } = await testDatabase();
  const env = productionEnv(db);
  try {
    await addCustomer(env, { email: "one@example.com", orders: 1, lastOrder: daysAgo(3) });
    await addCustomer(env, { email: "two@example.com", orders: 1, lastOrder: daysAgo(4) });
    await saveSegment(env as never, { name: "All", filter: {}, createdBy: "AGENT" }, NOW);
    const created = await createCampaign(env as never, {
      name: "Freeze", segmentId: "seg_all", subject: "נושא", html: HTML,
      ctaUrl: "https://tigerbrandsglobal.com/pages/novahair", proposedBy: "AGENT",
    }, NOW);

    const approved = await approveCampaign(env as never, created.campaignId, "harel", NOW);
    assert.equal(approved.recipients, 2);

    // A third person joining the segment after approval is not added.
    await addCustomer(env, { email: "three@example.com", orders: 1, lastOrder: daysAgo(1) });
    const frozen = await db.prepare(
      "SELECT COUNT(*) n FROM campaign_recipients WHERE campaign_id = ?",
    ).bind(created.campaignId).first<{ n: number }>();
    assert.equal(Number(frozen!.n), 2);

    await assert.rejects(approveCampaign(env as never, created.campaignId, "harel", NOW), /campaign_not_draft_approved/);
    await assert.rejects(setCampaignStatus(env as never, created.campaignId, "REJECTED", null, NOW), /campaign_cannot_rejected_from_approved/);

    const cancelled = await setCampaignStatus(env as never, created.campaignId, "CANCELLED", "changed my mind", NOW);
    assert.equal(cancelled.status, "CANCELLED");
    const skipped = await db.prepare(
      "SELECT COUNT(*) n FROM campaign_recipients WHERE campaign_id = ? AND skip_reason = 'campaign_cancelled'",
    ).bind(created.campaignId).first<{ n: number }>();
    assert.equal(Number(skipped!.n), 2);
  } finally {
    await dispose();
  }
});

test("the send budget keeps a daily reserve for lifecycle mail", async () => {
  const { db, dispose } = await testDatabase();
  try {
    // Free-tier defaults: guard at 90/day, reserve 30, so campaigns get 60.
    const env = productionEnv(db, { CAMPAIGN_BATCH_SIZE: "500" });
    let budget = await campaignBudget(env as never, NOW);
    assert.equal(budget.dayCeiling, 60);
    assert.equal(budget.allowed, 60);

    // 55 already sent today leaves 5 for campaigns, not 35.
    await db.prepare(
      `INSERT INTO lifecycle_usage_counters (period_type, period_key, emails_sent, updated_at)
       VALUES ('DAY', ?, 55, ?)`,
    ).bind(NOW.toISOString().slice(0, 10), isoNow(NOW)).run();
    budget = await campaignBudget(env as never, NOW);
    assert.equal(budget.allowed, 5);

    // Past the campaign ceiling, campaigns stop while lifecycle mail continues.
    await db.prepare(
      "UPDATE lifecycle_usage_counters SET emails_sent = 75 WHERE period_type = 'DAY' AND period_key = ?",
    ).bind(NOW.toISOString().slice(0, 10)).run();
    budget = await campaignBudget(env as never, NOW);
    assert.equal(budget.allowed, 0);
    assert.equal(budget.reason, "daily_campaign_ceiling");

    // A bigger plan lifts the ceiling with no code change.
    const upgraded = productionEnv(db, {
      CAMPAIGN_BATCH_SIZE: "500",
      RESEND_DAILY_EMAIL_LIMIT: "50000",
      RESEND_MONTHLY_EMAIL_LIMIT: "50000",
    });
    // CAMPAIGN_BATCH_SIZE is capped at 200 per tick, which is 28,800 a day.
    assert.equal((await campaignBudget(upgraded as never, NOW)).allowed, 200);
  } finally {
    await dispose();
  }
});

test("a send batches inside the budget, re-checks consent, and finishes the campaign", async () => {
  const { db, dispose } = await testDatabase();
  const env = productionEnv(db, { CAMPAIGN_BATCH_SIZE: "2" });
  try {
    // Distinct last-order dates make the queue order deterministic: a, b, c, d, e.
    const people = ["a@example.com", "b@example.com", "c@example.com", "d@example.com", "e@example.com"];
    for (const [index, email] of people.entries()) {
      await addCustomer(env, { email, orders: 1, lastOrder: daysAgo(index + 1), firstName: "דנה" });
    }
    await saveSegment(env as never, { name: "All", filter: {}, createdBy: "AGENT" }, NOW);
    const created = await createCampaign(env as never, {
      name: "Batch", segmentId: "seg_all", subject: "נושא", html: HTML,
      ctaUrl: "https://tigerbrandsglobal.com/pages/novahair", proposedBy: "AGENT",
    }, NOW);
    await approveCampaign(env as never, created.campaignId, "harel", NOW);

    const sentBodies: Array<Record<string, unknown>> = [];
    let counter = 0;
    const fetcher = (async (_url: string, init: RequestInit) => {
      sentBodies.push(JSON.parse(String(init.body)));
      counter += 1;
      return new Response(JSON.stringify({ id: `rid-${counter}` }), { status: 200 });
    }) as unknown as typeof fetch;

    // Tick one: only the batch size goes out.
    let result = await dispatchDueCampaigns(env as never, NOW, fetcher);
    assert.equal(result.sent, 2);
    assert.equal(sentBodies.length, 2);

    const body = sentBodies[0]!;
    assert.equal(body.subject, "נושא");
    assert.match(String(body.html), /שלום דנה/);
    assert.doesNotMatch(String(body.html), /\{\{/);
    assert.match(String(body.html), /\/api\/lifecycle\/u\//);
    assert.match(String(body.html), /\/api\/lifecycle\/click\//);
    const headers = body.headers as Record<string, string>;
    assert.match(headers["List-Unsubscribe"] ?? "", /^<https:\/\/.+\/api\/lifecycle\/u\/.+>$/);
    assert.equal(headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");

    const hashFor = (email: string) => hashEmail(email, "test-hash-key-that-is-never-used-in-production");

    // Two different things can happen to a frozen audience between ticks.
    // C clicks unsubscribe, which pulls them straight out of the queue.
    const cHash = await hashFor("c@example.com");
    const cToken = await ensureUnsubscribeToken(env as never, cHash, NOW);
    await applyUnsubscribe(env as never, String(cToken), NOW);
    const cRow = await db.prepare(
      "SELECT status, skip_reason FROM campaign_recipients WHERE campaign_id = ? AND email_hash = ?",
    ).bind(created.campaignId, cHash).first<{ status: string; skip_reason: string }>();
    assert.equal(cRow!.status, "SKIPPED");
    assert.equal(cRow!.skip_reason, "unsubscribed");

    // D hard-bounces elsewhere, so only the suppression list knows. Nothing
    // touched the queue, so the send-time re-check has to catch this one.
    const dHash = await hashFor("d@example.com");
    await db.prepare(
      `INSERT INTO suppressions (email_hash, source, reason, occurred_at, active, created_at, updated_at)
       VALUES (?, 'RESEND', 'bounce', ?, 1, ?, ?)`,
    ).bind(dHash, isoNow(NOW), isoNow(NOW), isoNow(NOW)).run();

    result = await dispatchDueCampaigns(env as never, NOW, fetcher);
    assert.equal(result.sent, 1);
    assert.equal(result.skipped, 1);

    const dRow = await db.prepare(
      "SELECT status, skip_reason FROM campaign_recipients WHERE campaign_id = ? AND email_hash = ?",
    ).bind(created.campaignId, dHash).first<{ status: string; skip_reason: string }>();
    assert.equal(dRow!.status, "SKIPPED");
    assert.equal(dRow!.skip_reason, "suppressed");

    const campaign = await db.prepare(
      "SELECT status, sent_count, skipped_count FROM campaigns WHERE campaign_id = ?",
    ).bind(created.campaignId).first<{ status: string; sent_count: number; skipped_count: number }>();
    assert.equal(campaign!.status, "SENT");
    assert.equal(Number(campaign!.sent_count), 3);
    assert.equal(Number(campaign!.skipped_count), 2);

    const report = await campaignReport(env as never, created.campaignId) as Record<string, never>;
    assert.equal((report.audience as unknown as Record<string, number>).sent, 3);
  } finally {
    await dispose();
  }
});

test("an unsubscribe stops every channel at once and reaches Shopify", async () => {
  const { db, dispose } = await testDatabase();
  const env = productionEnv(db);
  try {
    await addCustomer(env, { email: "leaver@example.com", id: "gid://shopify/Customer/55", orders: 1, lastOrder: daysAgo(2) });
    const hash = await hashEmail("leaver@example.com", "test-hash-key-that-is-never-used-in-production");
    const token = await ensureUnsubscribeToken(env as never, hash, NOW);
    assert.match(String(token), /^[A-Za-z0-9_-]{24,64}$/);
    // The token is stable, so one link keeps working across every email.
    assert.equal(await ensureUnsubscribeToken(env as never, hash, NOW), token);

    const result = await applyUnsubscribe(env as never, String(token), NOW);
    assert.deepEqual(result, { ok: true, alreadyUnsubscribed: false });

    const suppression = await db.prepare(
      "SELECT reason, active FROM suppressions WHERE email_hash = ?",
    ).bind(hash).first<{ reason: string; active: number }>();
    assert.equal(suppression!.reason, "marketing_unsubscribed");
    assert.equal(Number(suppression!.active), 1);

    const customer = await db.prepare(
      "SELECT consent_state FROM customers WHERE email_hash = ?",
    ).bind(hash).first<{ consent_state: string }>();
    assert.equal(customer!.consent_state, "UNSUBSCRIBED");

    const resendQueue = await db.prepare(
      "SELECT unsubscribed FROM resend_contact_updates WHERE email_hash = ?",
    ).bind(hash).first<{ unsubscribed: number }>();
    assert.equal(Number(resendQueue!.unsubscribed), 1);

    // Without this, the next Shopify consent sync would undo the unsubscribe.
    const shopifyQueue = await db.prepare(
      "SELECT shopify_customer_id, marketing_state, status FROM shopify_consent_updates WHERE email_hash = ?",
    ).bind(hash).first<{ shopify_customer_id: string; marketing_state: string; status: string }>();
    assert.equal(shopifyQueue!.shopify_customer_id, "gid://shopify/Customer/55");
    assert.equal(shopifyQueue!.marketing_state, "UNSUBSCRIBED");

    // The person is now out of every future segment.
    assert.equal(await countSegment(env as never, parseSegmentFilter({}), NOW), 0);

    assert.deepEqual(await applyUnsubscribe(env as never, String(token), NOW), { ok: true, alreadyUnsubscribed: true });
    assert.deepEqual(await applyUnsubscribe(env as never, "unknown-token-value-abcdefgh", NOW), { ok: false, alreadyUnsubscribed: false });
  } finally {
    await dispose();
  }
});

test("the unsubscribe page is public, needs no token in the URL bar, and one-click POST works", async () => {
  const { db, dispose } = await testDatabase();
  const env = productionEnv(db);
  try {
    await addCustomer(env, { email: "click@example.com", orders: 1 });
    const hash = await hashEmail("click@example.com", "test-hash-key-that-is-never-used-in-production");
    const token = String(await ensureUnsubscribeToken(env as never, hash, NOW));

    const page = await worker.fetch(
      new Request(`https://worker.test/api/lifecycle/u/${token}`),
      env as never,
      context as never,
    );
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /dir="rtl"/);
    assert.match(html, /noindex/);
    assert.match(html, /להפסיק לקבל מיילים שיווקיים\?/);
    // No guilt, and the service mail is explicitly kept.
    assert.match(html, /עדכוני הזמנה ומשלוח ימשיכו להישלח/);

    const posted = await worker.fetch(
      new Request(`https://worker.test/api/lifecycle/u/${token}`, { method: "POST" }),
      env as never,
      context as never,
    );
    assert.equal(posted.status, 200);
    assert.match(await posted.text(), /הוסרת מהרשימה/);
    const customer = await db.prepare(
      "SELECT consent_state FROM customers WHERE email_hash = ?",
    ).bind(hash).first<{ consent_state: string }>();
    assert.equal(customer!.consent_state, "UNSUBSCRIBED");

    const bad = await worker.fetch(
      new Request("https://worker.test/api/lifecycle/u/short"),
      env as never,
      context as never,
    );
    assert.equal(bad.status, 404);
  } finally {
    await dispose();
  }
});

test("campaign admin endpoints need the admin token and reject a bad filter", async () => {
  const { db, dispose } = await testDatabase();
  const env = productionEnv(db);
  try {
    await addCustomer(env, { email: "admin-seg@example.com", orders: 1 });

    const anonymous = await worker.fetch(
      new Request("https://worker.test/api/lifecycle/admin/segments"),
      env as never,
      context as never,
    );
    assert.equal(anonymous.status, 404);

    const auth = { Authorization: "Bearer test_admin_token", "Content-Type": "application/json" };
    const preview = await worker.fetch(
      new Request("https://worker.test/api/lifecycle/admin/segments/preview", {
        method: "POST", headers: auth, body: JSON.stringify({ filter: { consent: ["SUBSCRIBED"] } }),
      }),
      env as never,
      context as never,
    );
    assert.equal(preview.status, 200);
    assert.equal((await preview.json() as { count: number }).count, 1);

    const rejected = await worker.fetch(
      new Request("https://worker.test/api/lifecycle/admin/segments/preview", {
        method: "POST", headers: auth, body: JSON.stringify({ filter: { dropTable: true } }),
      }),
      env as never,
      context as never,
    );
    assert.equal(rejected.status, 400);
    assert.match((await rejected.json() as { error: string }).error, /unknown_key/);

    const saved = await worker.fetch(
      new Request("https://worker.test/api/lifecycle/admin/segments", {
        method: "POST", headers: auth,
        body: JSON.stringify({ name: "Engaged", filter: { consent: ["SUBSCRIBED"] }, createdBy: "AGENT" }),
      }),
      env as never,
      context as never,
    );
    assert.equal(saved.status, 200);

    const drafted = await worker.fetch(
      new Request("https://worker.test/api/lifecycle/admin/campaigns", {
        method: "POST", headers: auth,
        body: JSON.stringify({
          name: "Autumn", segmentId: "seg_engaged", subject: "נושא", html: HTML,
          ctaUrl: "https://tigerbrandsglobal.com/pages/novahair", proposedBy: "AGENT",
        }),
      }),
      env as never,
      context as never,
    );
    assert.equal(drafted.status, 201);
    const campaignId = (await drafted.json() as { campaignId: string }).campaignId;

    // A draft sends to nobody until it is approved.
    assert.equal((await dispatchDueCampaigns(env as never, NOW, okFetcher())).sent, 0);

    const approved = await worker.fetch(
      new Request(`https://worker.test/api/lifecycle/admin/campaigns/${campaignId}/approve`, {
        method: "POST", headers: auth, body: JSON.stringify({ approvedBy: "harel" }),
      }),
      env as never,
      context as never,
    );
    assert.equal(approved.status, 200);

    const report = await worker.fetch(
      new Request(`https://worker.test/api/lifecycle/admin/campaigns/${campaignId}`, { headers: auth }),
      env as never,
      context as never,
    );
    assert.equal(report.status, 200);
    const payload = await report.json() as { campaign: { status: string }; audience: { total: number } };
    assert.equal(payload.campaign.status, "APPROVED");
    assert.equal(payload.audience.total, 1);
  } finally {
    await dispose();
  }
});

test("a campaign click is attributed to its recipient without an automation row", async () => {
  const { db, dispose } = await testDatabase();
  const env = productionEnv(db, { CAMPAIGN_BATCH_SIZE: "5" });
  try {
    await addCustomer(env, { email: "clicker@example.com", orders: 1, lastOrder: daysAgo(2) });
    await saveSegment(env as never, { name: "All", filter: {}, createdBy: "AGENT" }, NOW);
    const created = await createCampaign(env as never, {
      name: "Clicks", segmentId: "seg_all", subject: "נושא", html: HTML,
      ctaUrl: "https://tigerbrandsglobal.com/pages/novahair", proposedBy: "AGENT",
    }, NOW);
    await approveCampaign(env as never, created.campaignId, "harel", NOW);

    let bodyHtml = "";
    const fetcher = (async (_url: string, init: RequestInit) => {
      bodyHtml = String((JSON.parse(String(init.body)) as { html: string }).html);
      return new Response(JSON.stringify({ id: "rid-click" }), { status: 200 });
    }) as unknown as typeof fetch;
    await dispatchDueCampaigns(env as never, NOW, fetcher);

    const token = bodyHtml.match(/\/api\/lifecycle\/click\/([A-Za-z0-9_-]+)/)?.[1];
    assert.ok(token, "campaign html should contain a tracked link");

    const redirect = await worker.fetch(
      new Request(`https://worker.test/api/lifecycle/click/${token}`),
      env as never,
      context as never,
    );
    assert.equal(redirect.status, 303);
    const location = new URL(redirect.headers.get("Location") ?? "");
    assert.equal(location.host, "tigerbrandsglobal.com");
    // Each campaign gets its own utm_campaign rather than a generic flow value.
    assert.equal(location.searchParams.get("utm_campaign"), `novahair_campaign_${created.slug}`);

    const hash = await hashEmail("clicker@example.com", "test-hash-key-that-is-never-used-in-production");
    const attribution = await db.prepare(
      "SELECT recipient_hash, entity_type FROM lifecycle_attribution WHERE entity_type = 'campaign'",
    ).first<{ recipient_hash: string; entity_type: string }>();
    assert.equal(attribution!.recipient_hash, hash);

    const recipient = await db.prepare(
      "SELECT clicked_at FROM campaign_recipients WHERE campaign_id = ? AND email_hash = ?",
    ).bind(created.campaignId, hash).first<{ clicked_at: string | null }>();
    assert.ok(recipient!.clicked_at, "the click should land on the campaign recipient row");
  } finally {
    await dispose();
  }
});
