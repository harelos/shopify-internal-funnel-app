import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { computeGrowthCockpitProfitBeforePaymentFees, type FinancialMetric } from "../src/lib/growth-cockpit-finance.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function metric(overrides: Partial<FinancialMetric>): FinancialMetric {
  return { amount: 100, currency: "USD", quality: "ACTUAL", source: "TEST", note: "", ...overrides };
}

/**
 * Product cost is now one row per sale at the price CJ charges for it. It is
 * ACTUAL when every sale in the window is priced and PARTIAL when some sale has
 * no CJ order yet — never a guess, and never the word "estimate" on screen.
 */
test("a cost that does not yet cover every sale still yields profit, and says so", () => {
  const revenue = metric({ amount: 1000 });
  const metaSpend = metric({ amount: 300 });
  const partial = metric({ amount: 250, quality: "PARTIAL", source: "CJ_ORDER_COSTS" });

  const strict = computeGrowthCockpitProfitBeforePaymentFees({ revenue, cjCosts: partial, metaSpend, orders: 10 });
  assert.equal(strict.complete, false);
  assert.match(strict.blockers.join(" "), /partial/);

  const accepted = computeGrowthCockpitProfitBeforePaymentFees({ revenue, cjCosts: partial, metaSpend, orders: 10, acceptIncompleteCosts: true });
  assert.equal(accepted.complete, true);
  assert.equal(accepted.cm1, 750);
  assert.equal(accepted.cm2, 450);
  assert.equal(accepted.breakEvenCpa, 75);
  // The figure must carry forward that the cost was incomplete.
  assert.equal(accepted.costQuality, "PARTIAL");
});

test("a fully priced window reports profit on an actual cost", () => {
  const result = computeGrowthCockpitProfitBeforePaymentFees({
    revenue: metric({ amount: 1000 }),
    cjCosts: metric({ amount: 250, quality: "ACTUAL", source: "CJ_ORDER_COSTS" }),
    metaSpend: metric({ amount: 300 }),
    orders: 10,
  });
  assert.equal(result.complete, true);
  assert.equal(result.costQuality, "ACTUAL");
});

test("accepting an incomplete cost never accepts a missing one", () => {
  const result = computeGrowthCockpitProfitBeforePaymentFees({
    revenue: metric({ amount: 1000 }),
    cjCosts: metric({ amount: null, quality: "MISSING", source: "CJ_ORDER_COSTS" }),
    metaSpend: metric({ amount: 300 }),
    orders: 10,
    acceptIncompleteCosts: true,
  });
  assert.equal(result.complete, false);
});

test("product cost is the per-sale CJ ledger, with no guessed fallback behind it", () => {
  const route = readFileSync(path.join(root, "src/routes/growth-cockpit.ts"), "utf8");
  assert.match(route, /const supplierCost = await supplierCostForRange\(/);
  assert.match(route, /cjCosts: productCost/);
  assert.match(route, /acceptIncompleteCosts: true/);
  // The trailing average and the paid-cost stand-in are both gone.
  assert.doesNotMatch(route, /CJ_TRAILING_AVERAGE/);
  assert.doesNotMatch(route, /trailingCogsPerOrder/);
  const block = route.slice(route.indexOf("const supplierCost"), route.indexOf("const strictProfit"));
  assert.doesNotMatch(block, /quality: "ESTIMATE"/);
  // Quality follows coverage: every sale priced means actual.
  assert.match(block, /unpricedOrders === 0 \? "ACTUAL" : "PARTIAL"/);
  // The screen carries that quality onto profit and break-even without the
  // word "estimate".
  const overview = readFileSync(path.join(root, "public/admin/js/overview.js"), "utf8");
  assert.match(overview, /metrics\.productCost/);
  assert.match(overview, /profit\.costQuality/);
  assert.doesNotMatch(overview, /estimat/i);
});

test("pixel and scope probes act as the app that owns the pixel", () => {
  const admin = readFileSync(path.join(root, "src/lib/shopify-admin.ts"), "utf8");
  // The Admin-created app's token reported "no pixel" for a pixel the
  // embedded app had already published.
  assert.match(admin, /private async appOwnedAccessToken/);
  const pixel = admin.slice(admin.indexOf("async webPixelConfiguration"), admin.indexOf("async appAccessScopes"));
  assert.match(pixel, /await this[.]appOwnedAccessToken[(]sessionToken[)]/);
  const scopes = admin.slice(admin.indexOf("async appAccessScopes"));
  assert.match(scopes.slice(0, 400), /await this[.]appOwnedAccessToken[(]sessionToken[)]/);
});
