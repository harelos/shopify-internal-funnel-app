import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");
const reconcile = read("src/services/growth-cockpit-reconcile.ts");
const worker = read("src/worker.ts");
const monitor = read("src/services/novahair-monitor.ts");
const operations = read("src/routes/operations.ts");

test("product cost is reconciled on a schedule, not only by hand", () => {
  // CJ costs had gone twenty days without a sync, which left contribution
  // margin unmeasurable and dropped a quarter of the health model.
  assert.match(reconcile, /export async function reconcileGrowthCockpitCjOrderCosts/);
  assert.match(worker, /run\("reconcileGrowthCockpitCjOrderCosts", reconcileGrowthCockpitCjOrderCosts\(\)\)/);
});

test("the schedule cannot exhaust CJ's rate limit", () => {
  // The cron fires every minute; the reconciliation reads CJ's list and makes
  // a detail call per unpriced order, so it must not run again for a while.
  const interval = Number(/CJ_ORDER_COST_REFRESH_INTERVAL_MS = (\d+) \* 60 \* 1000/.exec(reconcile)?.[1]);
  assert.ok(interval >= 15, `CJ would re-run every ${interval} minutes`);
  assert.match(reconcile, /hasRecentFinancialCoverage/);
  // Coverage is written even on a quiet week, otherwise the guard never engages.
  assert.match(reconcile, /retry on every tick/);
});

test("the CJ token survives a recycled isolate", () => {
  // An in-memory token is lost between invocations, and re-authenticating on
  // every cron tick is what the provider rate-limits.
  assert.match(monitor, /readCachedToken\(CJ_TOKEN_CACHE_ID\)/);
  assert.match(monitor, /writeCachedToken\(CJ_TOKEN_CACHE_ID/);
});

test("one failing reconciler cannot fail the whole tick", () => {
  assert.match(worker, /Promise\.allSettled/);
});

/**
 * The account-level stream keyed by the day CJ charged the account was built
 * on `actualPayment`, a field getOrderDetail never returns, and dated costs
 * days after the sale. Two definitions of "product cost" in one ledger is how
 * the dashboard came to show a number nobody could trace. One definition now:
 * one row per sale, at CJ's order total, dated by the sale.
 */
test("the payment-date cost stream is retired everywhere", () => {
  for (const file of [
    "src/services/growth-cockpit-reconcile.ts",
    "src/worker.ts",
    "src/routes/growth-cockpit.ts",
    "src/lib/financial-ledger.ts",
    "src/lib/growth-cockpit-comparison.ts",
    "public/admin/js/growth-cockpit.js",
    "public/admin/js/overview.js",
  ]) {
    assert.doesNotMatch(read(file), /CJ_PAID_ORDERS|cjPaidCosts|cj-paid-costs|reconcileGrowthCockpitCjCosts/, `${file} still refers to the retired stream`);
  }
  assert.throws(() => read("src/services/cj-paid-costs.ts"), "the retired writer still exists");
  // Operations judges cost freshness by the stream that is actually written.
  assert.match(operations, /latestBySource\(financialRows, "CJ_ORDER_COSTS"\)/);
});
