import assert from "node:assert/strict";
import test from "node:test";
import {
  computeGrowthCockpitProfit,
  computeGrowthCockpitProfitBeforePaymentFees,
  missingFinancialMetric,
  type FinancialMetric,
} from "../src/lib/growth-cockpit-finance.js";

function actual(amount: number, source: string): FinancialMetric {
  return { amount, currency: "USD", quality: "ACTUAL", source, note: "Verified test input." };
}

test("Growth Cockpit profit fails closed when a source is missing", () => {
  const result = computeGrowthCockpitProfit({
    revenue: actual(1000, "SHOPIFY"),
    cjCosts: actual(250, "CJ"),
    paymentFees: missingFinancialMetric("PAYMENTS", "Unavailable"),
    metaSpend: actual(300, "META"),
    orders: 10,
  });
  assert.equal(result.complete, false);
  assert.equal(result.cm1, null);
  assert.equal(result.cm2, null);
  assert.match(result.blockers.join(" "), /Payment fees is missing/);
});

test("Growth Cockpit profit refuses partial or estimated inputs", () => {
  const result = computeGrowthCockpitProfit({
    revenue: { ...actual(1000, "SHOPIFY"), quality: "PARTIAL" },
    cjCosts: { ...actual(250, "CJ"), quality: "ESTIMATE" },
    paymentFees: actual(50, "PAYMENTS"),
    metaSpend: actual(300, "META"),
    orders: 10,
  });
  assert.equal(result.complete, false);
  assert.equal(result.cm1, null);
  assert.match(result.blockers.join(" "), /Revenue is partial/);
  assert.match(result.blockers.join(" "), /CJ costs is estimate/);
});

test("Growth Cockpit computes CM1 and CM2 only from authoritative same-currency inputs", () => {
  const result = computeGrowthCockpitProfit({
    revenue: actual(1000, "SHOPIFY"),
    cjCosts: actual(250, "CJ"),
    paymentFees: actual(50, "PAYMENTS"),
    metaSpend: actual(300, "META"),
    orders: 10,
  });
  assert.deepEqual(result, {
    complete: true,
    currency: "USD",
    cm1: 700,
    cm2: 400,
    marginPct: 40,
    breakEvenCpa: 70,
    breakEvenRoas: 1.43,
    poas: 2.33,
    blockers: [],
  });
});

test("Growth Cockpit refuses mixed-currency profit", () => {
  const result = computeGrowthCockpitProfit({
    revenue: actual(1000, "SHOPIFY"),
    cjCosts: { ...actual(250, "CJ"), currency: "ILS" },
    paymentFees: actual(50, "PAYMENTS"),
    metaSpend: actual(300, "META"),
    orders: 10,
  });
  assert.equal(result.complete, false);
  assert.equal(result.currency, null);
  assert.match(result.blockers.join(" "), /do not share one reporting currency/);
});

test("Growth Cockpit calculates operator-approved CJ COGS before payment fees", () => {
  const result = computeGrowthCockpitProfitBeforePaymentFees({
    revenue: actual(1000, "SHOPIFY"),
    cjCosts: actual(250, "CJ_PAID_ORDERS"),
    metaSpend: actual(300, "META"),
    orders: 10,
  });
  assert.equal(result.complete, true);
  assert.equal(result.cm1, 750);
  assert.equal(result.cm2, 450);
  assert.equal(result.marginPct, 45);
});
