import assert from "node:assert/strict";
import test from "node:test";
import { compareGrowthCockpitMetric } from "../src/lib/growth-cockpit-comparison.js";
import type { FinancialMetric } from "../src/lib/growth-cockpit-finance.js";

function actual(amount: number, currency = "USD"): FinancialMetric {
  return { amount, currency, quality: "ACTUAL", source: "TEST", note: "Test metric" };
}

test("Growth Cockpit compares only authoritative equivalent metrics", () => {
  const comparison = compareGrowthCockpitMetric(actual(150), actual(100));
  assert.equal(comparison.quality, "ACTUAL");
  assert.equal(comparison.absoluteChange, 50);
  assert.equal(comparison.percentChange, 50);
});

test("Growth Cockpit suppresses comparisons for partial or mixed-currency metrics", () => {
  const partial = compareGrowthCockpitMetric({ ...actual(150), quality: "PARTIAL" }, actual(100));
  assert.equal(partial.quality, "MISSING");
  assert.equal(partial.absoluteChange, null);

  const mixed = compareGrowthCockpitMetric(actual(150, "USD"), actual(100, "ILS"));
  assert.equal(mixed.quality, "MISSING");
  assert.equal(mixed.currency, null);
});
