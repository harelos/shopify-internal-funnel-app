import assert from "node:assert/strict";
import test from "node:test";
import { judgeAdSets } from "../src/lib/ad-set-verdict.js";
import type { MetaAdSetPerformance } from "../src/lib/meta-campaign-spend.js";
import { autoSendTopics, evaluateSupportPolicy, mayAutoSend } from "../src/lib/support-policy.js";
import { looksLikeBot, requestLimited } from "../src/lib/request-limit.js";

const adSet = (overrides: Partial<MetaAdSetPerformance> = {}): MetaAdSetPerformance => ({
  campaignName: "Prospecting", adSetName: "IL 25-45", adSetId: "1",
  spend: 100, purchases: 2, purchaseValue: 300, costPerPurchase: 50, ...overrides,
});

/**
 * Blended ROAS can look healthy while one ad set buys every order above what
 * the business can afford. Break-even CPA is the ceiling: revenue minus product
 * cost and payment fees, per order.
 */
test("an ad set paying more per order than break-even is called out", () => {
  const [over] = judgeAdSets([adSet({ costPerPurchase: 52 })], 43.69);
  assert.equal(over.verdict, "OVER_BREAK_EVEN");
  assert.equal(over.headroom, -8.31);

  const [under] = judgeAdSets([adSet({ costPerPurchase: 30 })], 43.69);
  assert.equal(under.verdict, "UNDER_BREAK_EVEN");
  assert.equal(under.headroom, 13.69);
});

test("spend with no purchases is flagged rather than divided by zero", () => {
  const [row] = judgeAdSets([adSet({ purchases: 0, costPerPurchase: null })], 43.69);
  assert.equal(row.verdict, "NO_PURCHASES");
  assert.equal(row.headroom, null);
});

test("without a break-even ceiling no ad set is judged", () => {
  const [row] = judgeAdSets([adSet()], null);
  assert.equal(row.verdict, "UNKNOWN");
  assert.equal(row.headroom, null);
});

/**
 * Widening auto-send is the owner's risk decision, but some topics can never be
 * answered without a person however the setting is configured.
 */
test("money and safety topics can never be configured into auto-send", () => {
  const wide = autoSendTopics(() => "ORDER_STATUS,REFUND,PAYMENT_DISPUTE,PRODUCT_SAFETY,DELIVERY_DISPUTE,TRUST");
  assert.ok(wide.has("ORDER_STATUS"));
  assert.ok(wide.has("TRUST"), "a topic the owner allowed should be allowed");
  for (const forbidden of ["REFUND", "PAYMENT_DISPUTE", "PRODUCT_SAFETY", "DELIVERY_DISPUTE"]) {
    assert.ok(!wide.has(forbidden), `${forbidden} must never auto-send`);
  }
});

test("the default stays the two topics answerable from verified facts", () => {
  assert.deepEqual([...autoSendTopics(() => "")].sort(), ["GENERAL_SHIPPING", "ORDER_STATUS"]);
  const policy = evaluateSupportPolicy("איפה ההזמנה שלי?");
  const base = { automationMode: "AUTOSEND_LOW_RISK", policy, confidence: 0.99, hasVerifiedOrder: true, hasUnverifiedClaims: false };
  assert.equal(mayAutoSend(base), true);
  assert.equal(mayAutoSend({ ...base, allowedTopics: new Set(["GENERAL_SHIPPING"]) }), false);
});

/**
 * Conversion divides buyers by tracked visitors, so the visit endpoint can move
 * a number the owner makes decisions on.
 */
test("robots and floods cannot inflate the tracked-visitor count", () => {
  assert.equal(looksLikeBot("Mozilla/5.0 (compatible; bingbot/2.0)"), true);
  assert.equal(looksLikeBot("facebookexternalhit/1.1"), true);
  assert.equal(looksLikeBot(""), true, "a request with no user agent is not a shopper");
  assert.equal(looksLikeBot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1"), false);

  const request = { get: () => "203.0.113.9", ip: "203.0.113.9" };
  let blocked = 0;
  for (let attempt = 0; attempt < 70; attempt += 1) if (requestLimited(request, "test_visit", 60, 60_000)) blocked += 1;
  assert.ok(blocked >= 9 && blocked <= 11, `expected the flood to be cut off, blocked ${blocked}`);
});
