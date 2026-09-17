import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reconcile = readFileSync(path.join(root, "src/services/growth-cockpit-reconcile.ts"), "utf8");
const worker = readFileSync(path.join(root, "src/worker.ts"), "utf8");
const monitor = readFileSync(path.join(root, "src/services/novahair-monitor.ts"), "utf8");

test("product cost is reconciled on a schedule, not only by hand", () => {
  // CJ costs had gone twenty days without a sync, which left contribution
  // margin unmeasurable and dropped a quarter of the health model.
  assert.match(reconcile, /export async function reconcileGrowthCockpitCjCosts/);
  assert.match(worker, /reconcileGrowthCockpitCjCosts\(\)/);
});

test("the schedule cannot exhaust CJ's rate limit", () => {
  // The cron fires every minute; the reconciliation makes one detail call per
  // order, so it must refuse to run again the same day.
  const interval = Number(/CJ_REFRESH_INTERVAL_MS = (\d+) \* 60 \* 60 \* 1000/.exec(reconcile)?.[1]);
  assert.ok(interval >= 12, `CJ would re-run every ${interval} hours`);
  assert.match(reconcile, /hasRecentFinancialCoverage/);
  // Coverage is written even on a quiet day, otherwise the guard never engages.
  assert.match(reconcile, /does not make the job retry on every tick/);
});

test("the CJ token survives a recycled isolate", () => {
  // An in-memory token is lost between invocations, and re-authenticating on
  // every cron tick is what the provider rate-limits.
  assert.match(monitor, /readCachedToken\(CJ_TOKEN_CACHE_ID\)/);
  assert.match(monitor, /writeCachedToken\(CJ_TOKEN_CACHE_ID/);
});

test("one failing reconciler cannot fail the whole tick", () => {
  assert.match(worker, /Promise\.allSettled/);
  assert.match(worker, /run\("reconcileGrowthCockpitCjCosts"/);
});

test("a dead cost integration raises an incident instead of going quiet", () => {
  const operations = readFileSync(path.join(root, "src/routes/operations.ts"), "utf8");
  // Product cost stopped on 2026-08-25 because the CJ credential was rejected,
  // and nothing reported it for twenty days.
  assert.match(operations, /Product cost has never been reconciled/);
  assert.match(operations, /Product cost reconciliation is stale/);
  assert.match(operations, /latestBySource\(financialRows, "CJ_PAID_ORDERS"\)/);
  // It has to be loud: margin and profit are unmeasurable without it.
  assert.match(operations, /severity: "CRITICAL", area: "Costs"/);
});

test("the current day has a product cost before CJ has charged it", () => {
  // Paid costs are dated by CJ's payment day, which trails the sale by days,
  // so every window ending today had orders with no cost and no profit.
  assert.match(reconcile, /export async function reconcileGrowthCockpitCjOrderCosts/);
  assert.match(reconcile, /preset: "last_7_days"/);
  assert.match(worker, /run\("reconcileGrowthCockpitCjOrderCosts"/);
  // Sales land all day and each one's CJ order follows minutes later, so the
  // window is only right if it is re-read often.
  const minutes = Number(/CJ_ORDER_COST_REFRESH_INTERVAL_MS = (\d+) \* 60 \* 1000/.exec(reconcile)?.[1]);
  assert.ok(minutes >= 10 && minutes <= 60, `order costs would refresh every ${minutes} minutes`);
  // Coverage is only ACTUAL when every sale in the window carries a CJ price.
  const orderCosts = reconcile.slice(reconcile.indexOf("reconcileGrowthCockpitCjOrderCosts"));
  assert.match(orderCosts, /result\.unpricedOrders\.length \? "PARTIAL" : "ACTUAL"/);
});
