import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { calendarDayLabels, sumDailyCoverage, type DailyCoverageRow } from "../src/lib/financial-window.js";
import { computeGrowthCockpitProfitBeforePaymentFees, type FinancialMetric } from "../src/lib/growth-cockpit-finance.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function day(localDate: string, amount: number, orders = 1, quality: DailyCoverageRow["quality"] = "ACTUAL"): DailyCoverageRow {
  return { localDate, amount, currency: "ILS", quality, rowCount: 1, orders };
}

test("a window of settled days is added up instead of re-queried", () => {
  const rows = [day("2026-09-10", 100, 3), day("2026-09-11", 250.5, 5), day("2026-09-12", 0, 0)];
  const total = sumDailyCoverage(rows, "2026-09-10", "2026-09-12");
  assert.equal(total.complete, true);
  assert.equal(total.amount, 350.5);
  assert.equal(total.orders, 8);
  assert.equal(total.currency, "ILS");
  assert.equal(total.quality, "ACTUAL");
});

test("one missing day refuses the shortcut rather than under-reporting the period", () => {
  // A ninety-day total silently missing a day would look like a real decline.
  const total = sumDailyCoverage([day("2026-09-10", 100), day("2026-09-12", 100)], "2026-09-10", "2026-09-12");
  assert.equal(total.complete, false);
  assert.deepEqual(total.missingDays, ["2026-09-11"]);
});

test("a settled day reported as partial holds the whole window down", () => {
  const total = sumDailyCoverage([day("2026-09-10", 100), day("2026-09-11", 100, 1, "PARTIAL")], "2026-09-10", "2026-09-11");
  assert.equal(total.complete, true);
  assert.equal(total.quality, "PARTIAL");
});

test("mixed currencies are never summed into one number", () => {
  const rows = [day("2026-09-10", 100), { ...day("2026-09-11", 30), currency: "USD" }];
  const total = sumDailyCoverage(rows, "2026-09-10", "2026-09-11");
  assert.equal(total.complete, false);
  assert.equal(total.currency, null);
});

test("day labels cross months and years without drifting", () => {
  assert.deepEqual(calendarDayLabels("2026-08-30", "2026-09-02"), ["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"]);
  assert.deepEqual(calendarDayLabels("2026-12-31", "2027-01-01"), ["2026-12-31", "2027-01-01"]);
  assert.deepEqual(calendarDayLabels("2026-09-10", "2026-09-10"), ["2026-09-10"]);
});

test("the finance route reads settled days and only reads today live", () => {
  const route = readFileSync(path.join(root, "src/routes/growth-cockpit.ts"), "utf8");
  assert.match(route, /async function shopifyWindowFinancials/);
  assert.match(route, /readDailyFinancialCoverage/);
  assert.match(route, /shopifyWindowFinancials\(range, token\)/);
  // A window missing a settled day must fall back to the live read.
  assert.match(route, /if \(!settledRevenue\.complete\) return liveShopifyWindow\(range, token\)/);
  // Repeated loads of the same window are answered from memory.
  assert.match(route, /FINANCE_CACHE_TTL_SETTLED_MS = 5 \* 60 \* 1000/);
  assert.match(route, /FINANCE_CACHE_TTL_CURRENT_MS = 60 \* 1000/);
  assert.match(route, /writeFinanceCache\(cacheKey, payload, includesCurrentDay\)/);
});

function metric(overrides: Partial<FinancialMetric>): FinancialMetric {
  return { amount: 100, currency: "USD", quality: "ACTUAL", source: "TEST", note: "", ...overrides };
}

test("profit is what is left after product cost, payment fees and ad spend", () => {
  const result = computeGrowthCockpitProfitBeforePaymentFees({
    revenue: metric({ amount: 1000 }),
    cjCosts: metric({ amount: 250 }),
    metaSpend: metric({ amount: 300 }),
    paymentFees: metric({ amount: 50, source: "SHOPIFY_TRANSACTION_FEES" }),
    orders: 10,
  });
  assert.equal(result.paymentFeesIncluded, true);
  assert.equal(result.cm1, 700);
  assert.equal(result.cm2, 400);
  assert.equal(result.marginPct, 40);
  // Break-even is what may be paid per order once the fee is already gone.
  assert.equal(result.breakEvenCpa, 70);
});

test("missing fees produce a figure that says the fee is not in it", () => {
  const result = computeGrowthCockpitProfitBeforePaymentFees({
    revenue: metric({ amount: 1000 }),
    cjCosts: metric({ amount: 250 }),
    metaSpend: metric({ amount: 300 }),
    paymentFees: metric({ amount: null, quality: "MISSING" }),
    orders: 10,
  });
  assert.equal(result.complete, true);
  assert.equal(result.paymentFeesIncluded, false);
  assert.equal(result.cm2, 450);
});

test("a fee in another currency is never subtracted from the reported revenue", () => {
  const result = computeGrowthCockpitProfitBeforePaymentFees({
    revenue: metric({ amount: 1000, currency: "USD" }),
    cjCosts: metric({ amount: 250 }),
    metaSpend: metric({ amount: 300 }),
    paymentFees: metric({ amount: 180, currency: "ILS" }),
    orders: 10,
  });
  assert.equal(result.paymentFeesIncluded, false);
  assert.equal(result.cm2, 450);
});

test("the screen says which costs the profit figure is net of", () => {
  const overview = readFileSync(path.join(root, "public/admin/js/overview.js"), "utf8");
  assert.match(overview, /profit\.paymentFeesIncluded/);
  assert.match(overview, /before payment fees/);
});

test("one revenue number per screen, from the financial contract", () => {
  const overview = readFileSync(path.join(root, "public/admin/js/overview.js"), "utf8");
  // The analytics endpoint only sees visitors the app tracked, so its order
  // count is a subset; showing its revenue beside a profit built on every
  // Shopify order put two different revenues on one screen.
  assert.doesNotMatch(overview, /setText\("metric-revenue", currency\.format\(Number\(data\.totalRevenue/);
  assert.doesNotMatch(overview, /setText\("metric-aov", currency\.format\(Number\(data\.aov/);
  assert.match(overview, /paintFinanceTile\("revenue", moneyText\(revenue\)/);
  assert.match(overview, /Net revenue . paid orders/);
});

test("a window spanning the store's currency change is not called incomplete", () => {
  const admin = readFileSync(path.join(root, "src/lib/shopify-admin.ts"), "utf8");
  assert.match(admin, /const complete = rangeWithinDefaultOrderWindow && !hasNextPage;/);
  assert.doesNotMatch(admin, /const complete = rangeWithinDefaultOrderWindow && !hasNextPage && currencies\.length/);
});
