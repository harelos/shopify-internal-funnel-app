import test from "node:test";
import assert from "node:assert/strict";
import { assignPopupTreatment, hashPopupIdentity, summarizePopupAttribution } from "../src/lib/popup-attribution.js";

const variants = [
  { key: "a", weightBasisPoints: 5000 },
  { key: "b", weightBasisPoints: 5000 },
];

test("treatment assignment is sticky for the same visitor and experiment", () => {
  const first = assignPopupTreatment({ campaignKey: "welcome", experimentVersion: 2, visitorId: "visitor-1", holdoutBasisPoints: 1000, variants });
  const second = assignPopupTreatment({ campaignKey: "welcome", experimentVersion: 2, visitorId: "visitor-1", holdoutBasisPoints: 1000, variants });
  assert.deepEqual(second, first);
});

test("holdout assignment never exposes a popup variant", () => {
  let found = false;
  for (let index = 0; index < 1000; index += 1) {
    const assignment = assignPopupTreatment({ campaignKey: "welcome", experimentVersion: 1, visitorId: `visitor-${index}`, holdoutBasisPoints: 5000, variants });
    if (assignment.group === "HOLDOUT") {
      assert.equal(assignment.variantKey, null);
      assert.equal(assignment.variantBucket, null);
      found = true;
      break;
    }
  }
  assert.equal(found, true);
});

test("variant weights must total exactly 10000 basis points", () => {
  assert.throws(() => assignPopupTreatment({
    campaignKey: "welcome",
    experimentVersion: 1,
    visitorId: "visitor-1",
    variants: [{ key: "a", weightBasisPoints: 9000 }],
  }), /10,000 basis points/);
});

test("identity hashing requires a strong server secret and is deterministic", () => {
  const secret = "12345678901234567890123456789012";
  const first = hashPopupIdentity("visitor-1", secret);
  const second = hashPopupIdentity("visitor-1", secret);
  assert.equal(first, second);
  assert.notEqual(first, hashPopupIdentity("visitor-2", secret));
  assert.throws(() => hashPopupIdentity("visitor-1", "short"), /at least 32 characters/);
});

test("summary compares popup treatment against no-popup holdout", () => {
  const assignments = [
    { id: "p1", group: "POPUP" as const, variantKey: "a" },
    { id: "p2", group: "POPUP" as const, variantKey: "b" },
    { id: "h1", group: "HOLDOUT" as const, variantKey: null },
    { id: "h2", group: "HOLDOUT" as const, variantKey: null },
  ];
  const conversions = [
    { popupAssignmentId: "p1", checkoutToken: "c1", checkoutStartedAt: new Date(), shopifyOrderGid: "gid://shopify/Order/1", netRevenueAmount: 100 },
    { popupAssignmentId: "p2", checkoutToken: "c2", checkoutStartedAt: new Date() },
    { popupAssignmentId: "h1", checkoutToken: "c3", checkoutStartedAt: new Date() },
  ];
  const summary = summarizePopupAttribution(assignments, conversions);
  assert.equal(summary.popupPurchaseRatePct, 50);
  assert.equal(summary.holdoutPurchaseRatePct, 0);
  assert.equal(summary.absoluteLiftPctPoints, 50);
  assert.equal(summary.relativeLiftPct, null);
  assert.equal(summary.verifiedRevenue, 100);
  assert.equal(summary.variantRevenue.a, 100);
});
