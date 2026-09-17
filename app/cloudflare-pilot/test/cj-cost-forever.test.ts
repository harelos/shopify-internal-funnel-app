import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The invariants behind "the dashboard shows the right supplier cost from now
 * on". Each one was broken in production on 2026-09-17 and each is pinned to
 * the source so that the next deploy from the wrong folder fails here first.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Checkouts on this laptop carry CRLF; the pins below are written for LF.
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");
const monitor = read("src/services/novahair-monitor.ts");
const between = (source: string, from: string, to: string) => {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + 1);
  assert.ok(start >= 0 && end > start, `could not find ${from} .. ${to}`);
  return source.slice(start, end);
};

test("a supplier cost is dated by the sale, never by when the code ran", () => {
  // Six week-old orders were once booked on the day a sweep re-queued them,
  // because the replayed payload carried no sale date and the code fell back
  // to "now".
  const cost = between(monitor, "async function recordSupplierCost", "export async function processPendingQueueCron");
  assert.match(cost, /processed_at \|\| orderPayload\?\.created_at/);
  assert.doesNotMatch(cost, /verified_at|Date\.now\(\)|new Date\(\)/);
  assert.match(cost, /leaving the cost to the reconciler/);
  // Both writers store one row shape: CJ's order total, product plus postage.
  assert.match(cost, /cjOrderCost\(cj\)/);
  assert.match(cost, /costBasis: "CJ_ORDER"/);
  assert.doesNotMatch(cost, /quality: "ESTIMATE"/);
  assert.doesNotMatch(monitor, /verified_at\b.*occurredDate|costDateSource/);
  // The replayed payload carries the sale's own timestamps.
  const admin = read("src/lib/shopify-admin.ts");
  const payload = between(admin, "async orderPayloadForFulfilment", "async customerRepeatSummary");
  assert.match(payload, /processedAt createdAt/);
  assert.match(payload, /processed_at: order\.processedAt/);
});

test("nothing is created on a half-read CJ list", () => {
  // A CJ timeout on page two made six shipped orders look absent; six
  // duplicate orders followed.
  const backfill = read("src/services/cj-order-backfill.ts");
  assert.match(backfill, /readCjOrderIndex\(/);
  assert.match(backfill, /cj_list_incomplete/);
  assert.match(backfill, /cj_list_failed/);
  assert.doesNotMatch(backfill, /catch \{ break; \}/);
  // The queue's own creation path checks every purchase prefix, back to the
  // sale, adopts what it finds, and throws on a partial read.
  const finder = between(monitor, "async function findPurchasedCjOrder", "async function ensureAutoCjOrder");
  assert.match(finder, /purchasedCjOrdersByNumber/);
  assert.match(finder, /refusing to create an order on a partial list/);
  assert.match(finder, /adopted: true/);
  assert.doesNotMatch(monitor, /pageNum: 1, pageSize: 100 \}\);\n  const orders = listRes/);
});

test("an order CJ cannot supply is parked loudly, not dropped", () => {
  // #4481 (Golden Blonde) was paid, never queued, and never mentioned.
  for (const file of [
    "src/services/novahair-monitor.ts",
    "src/services/cj-order-backfill.ts",
    "src/routes/operations.ts",
    "src/services/owner-digest.ts",
    "src/services/cj-cost-audit.ts",
  ]) {
    assert.match(read(file), /NEEDS_SUPPLIER_MAPPING/, `${file} does not know the parked state`);
  }
  const webhook = monitor.slice(monitor.indexOf("export async function processNovaHairOrderWebhook"));
  assert.match(webhook, /planSupplierOrder\(lineItems\)/);
  assert.match(webhook, /syncState: "NEEDS_SUPPLIER_MAPPING"/);
  // A parked order releases itself once the mapping exists in code.
  assert.match(read("src/services/cj-order-backfill.ts"), /SET "syncState" = 'WAITING_FOR_CJ_SYNC', "expectedData" = \?/);
});

test("the parcel is planned again from the order's own lines on every attempt", () => {
  // #4486 was queued before the extra-bottle upsell was understood; the
  // stored plan said four bottles for a six-bottle sale.
  const queue = between(monitor, "export async function processPendingQueueCron", "export async function processNovaHairOrderWebhook");
  assert.match(queue, /const planned = planSupplierOrder\(/);
  assert.match(queue, /expected = planned\.expected/);
  // The verification compares add-ons too, so a mapped add-on in the CJ order
  // is not an "unknown VID" that drafts the product.
  assert.match(queue, /for \(const addon of Object\.values\(CJ_ADDON_MAPPINGS\)\) keyByVid\.set/);
  assert.match(queue, /expectedQuantities\[`addon:\$\{addon\.sku\}`\]/);
});

test("the morning digest and the API carry the cost audit", () => {
  const digest = read("src/services/owner-digest.ts");
  assert.match(digest, /auditCjSupplierCosts\(\{ days: 7/);
  assert.match(digest, /more than one CJ order/);
  assert.match(digest, /The cost audit could not run/);
  assert.match(read("src/routes/growth-cockpit.ts"), /router\.get\("\/growth-cockpit\/cj-cost-audit"/);
});

test("the Railway worker no longer creates CJ orders unless told to", () => {
  const python = read("../../cj-sync-worker/worker.py");
  assert.match(python, /def create_orders_enabled\(\) -> bool:/);
  assert.match(python, /if create_orders_enabled\(\):\n        log\("cycle start: creating CJ orders"\)/);
  assert.match(python, /os\.getenv\("SYNC_CREATE_ORDERS", "false"\)/);
});
