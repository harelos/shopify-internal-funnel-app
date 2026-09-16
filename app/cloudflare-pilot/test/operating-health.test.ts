import assert from "node:assert/strict";
import test from "node:test";
import { computeOperatingHealth, healthBandFor, type HealthInput } from "../src/lib/operating-health.js";

const complete: HealthInput = {
  netRevenue: 884.46, adSpend: 58.33, marginPct: 48.1,
  landingPageViews: 56, linkClicks: 66,
  initiateCheckout: 22, addToCart: 23,
  ordersLinkedToVisitor: 10, totalOrders: 11,
};

test("a complete day scores on the whole model", () => {
  const result = computeOperatingHealth(complete);
  assert.equal(result.coveredWeight, 1);
  assert.equal(result.note, "Scored on every input.");
  assert.ok(result.score != null && result.score >= 0 && result.score <= 100);
  assert.equal(result.components.filter(component => component.available).length, 5);
});

test("each sub-metric is bounded by its floor and ceiling", () => {
  const floored = computeOperatingHealth({ ...complete, netRevenue: 1, adSpend: 100, marginPct: -40 });
  const mer = floored.components.find(component => component.key === "mer")!;
  const margin = floored.components.find(component => component.key === "margin")!;
  assert.equal(mer.score, 0);
  assert.equal(margin.score, 0);

  const ceilinged = computeOperatingHealth({ ...complete, netRevenue: 10000, adSpend: 100, marginPct: 95 });
  assert.equal(ceilinged.components.find(component => component.key === "mer")!.score, 100);
  assert.equal(ceilinged.components.find(component => component.key === "margin")!.score, 100);
});

test("a missing input is excluded rather than scored as zero", () => {
  const withoutMargin = computeOperatingHealth({ ...complete, marginPct: null });
  const margin = withoutMargin.components.find(component => component.key === "margin")!;
  assert.equal(margin.available, false);
  assert.equal(margin.score, null);
  assert.equal(withoutMargin.coveredWeight, 0.75);
  assert.match(withoutMargin.note, /Contribution margin could not be measured/);
  // Excluding it must not drag the score down the way a zero would.
  const zeroed = computeOperatingHealth({ ...complete, marginPct: 0 });
  assert.ok((withoutMargin.score as number) > (zeroed.score as number));
});

test("a period with nothing verifiable refuses to publish a score", () => {
  const empty = computeOperatingHealth({
    netRevenue: null, adSpend: null, marginPct: null, landingPageViews: null,
    linkClicks: null, initiateCheckout: null, addToCart: null,
    ordersLinkedToVisitor: null, totalOrders: null,
  });
  assert.equal(empty.score, null);
  assert.equal(empty.band, null);
  assert.equal(empty.coveredWeight, 0);
});

test("division by zero never produces a score", () => {
  const noSpend = computeOperatingHealth({ ...complete, adSpend: 0 });
  assert.equal(noSpend.components.find(component => component.key === "mer")!.available, false);
  const noCarts = computeOperatingHealth({ ...complete, addToCart: 0 });
  assert.equal(noCarts.components.find(component => component.key === "checkout")!.available, false);
});

test("bands follow the thresholds the brief specifies", () => {
  assert.equal(healthBandFor(0).id, "critical");
  assert.equal(healthBandFor(39).id, "critical");
  assert.equal(healthBandFor(40).id, "warning");
  assert.equal(healthBandFor(59).id, "warning");
  assert.equal(healthBandFor(60).id, "healthy");
  assert.equal(healthBandFor(79).id, "healthy");
  assert.equal(healthBandFor(80).id, "excellent");
  assert.equal(healthBandFor(100).id, "excellent");
});
