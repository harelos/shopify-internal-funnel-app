import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { bundleSignature, cjOrderCost, matchCjOrders, shopifyOrderNumberOf, type CjOrderListRow } from "../src/lib/cj-cost-match.js";
import { extractShopifyStoredContext } from "../src/lib/shopify-stored-context.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const order = (number: string, id: string, skus: string[] = ["NOVASALE-4-4-0-0-0-0"]) => ({
  id: `gid://shopify/Order/${id}`,
  legacyResourceId: id,
  name: `#${number}`,
  processedAt: "2026-09-16T04:01:21Z",
  netPaymentAmount: 77.21,
  currency: "USD",
  lineItems: skus.map(sku => ({ sku, quantity: 1 })),
});

/**
 * CJ holds two rows per sale: the store-connected shadow ("#4470", no amount,
 * never paid) and the order actually purchased ("AUTO-4470"). The matcher knew
 * only the RESCUE- prefix, so it matched the shadow and booked $0 — a
 * nine-order day reported $34.13 of goods.
 */
test("the purchased CJ order wins over the store shadow, whatever its prefix", () => {
  const shadow: CjOrderListRow = { orderId: "s1", orderNum: "#4470", orderStatus: "CREATED", orderAmount: null, productAmount: 0 };
  for (const prefix of ["AUTO", "RESCUE", "MANUAL", "BACKFILL"]) {
    const purchased: CjOrderListRow = { orderId: "p1", orderNum: `${prefix}-4470`, orderStatus: "CREATED", orderAmount: 34.13, productAmount: 6.06, postageAmount: 28.07 };
    const matches = matchCjOrders([order("4470", "7482186334503")], [shadow, purchased]);
    assert.equal(matches.length, 1, prefix);
    assert.equal(matches[0].cj.orderNum, `${prefix}-4470`);
    assert.equal(cjOrderCost(matches[0].cj), 34.13);
  }
});

test("a CJ row with no amount is never matched, so no sale books a zero cost", () => {
  const shadow: CjOrderListRow = { orderId: "s1", orderNum: "#4471", orderStatus: "CREATED", orderAmount: null, productAmount: 0 };
  assert.deepEqual(matchCjOrders([order("4471", "7482620510503")], [shadow]), []);
});

test("a cancelled or trashed CJ order is not a cost", () => {
  for (const status of ["CANCELLED", "TRASH"]) {
    const row: CjOrderListRow = { orderId: "t1", orderNum: "RESCUE-4453", orderStatus: status, orderAmount: 34.13 };
    assert.deepEqual(matchCjOrders([order("4453", "1")], [row]), []);
  }
});

test("the cost is product plus the shipping CJ quoted, even before CJ totals it", () => {
  assert.equal(cjOrderCost({ orderAmount: 54.8, productAmount: 9.62, postageAmount: 45.18 }), 54.8);
  assert.equal(cjOrderCost({ orderAmount: null, productAmount: 6.06, postageAmount: 28.07 }), 34.13);
  assert.equal(cjOrderCost({ orderAmount: 0, productAmount: 0, postageAmount: 0 }), null);
});

test("every CJ order-number shape resolves to its Shopify order", () => {
  assert.equal(shopifyOrderNumberOf({ orderNum: "AUTO-4470" }), "4470");
  assert.equal(shopifyOrderNumberOf({ orderNum: "#4470" }), "4470");
  assert.equal(shopifyOrderNumberOf({ orderNum: "NOVASALE-4" }), null);
});

test("a sale CJ has not received yet is keyed by its exact bundle", () => {
  assert.equal(bundleSignature(order("4471", "1", ["NOVASALE-4-0-0-4-0-0-0"])), "NOVASALE-4-0-0-4-0-0-0x1");
  // Line order must not change the key, or the same bundle would price twice.
  assert.equal(
    bundleSignature(order("4476", "2", ["NOVASALE-2-0-0-2-0-0", "CJYD197393402BY"])),
    bundleSignature(order("4476", "2", ["CJYD197393402BY", "NOVASALE-2-0-0-2-0-0"])),
  );
  assert.equal(bundleSignature(order("4999", "3", [])), null);
});

/**
 * This store silently drops a cart attribute whose key starts with
 * underscores: the write echoes it back, /cart.js no longer has it, and the
 * order carries no attribute at all. Verified against the live cart on
 * 2026-09-16, which is why the storefront writes "funnel_context".
 */
test("the order reads the attribute key the storefront actually writes", () => {
  const context = JSON.stringify({ version: 1, visitorId: "v0123456789abcdef", firstTouch: { utmSource: "meta" } });
  const current = extractShopifyStoredContext([{ key: "funnel_context", value: context }], "jacobfelipe.myshopify.com");
  assert.equal(current?.context.visitorId, "v0123456789abcdef");
  // Orders placed before the change keep their attribution.
  const legacy = extractShopifyStoredContext([{ key: "__funnel_context__", value: context }], "jacobfelipe.myshopify.com");
  assert.equal(legacy?.context.visitorId, "v0123456789abcdef");
  assert.equal(extractShopifyStoredContext([{ key: "something_else", value: context }], "jacobfelipe.myshopify.com"), null);
});

test("no supplier cost is ever presented to the owner as an estimate", () => {
  const reconcile = readFileSync(path.join(root, "src/services/cj-cost-reconcile.ts"), "utf8");
  assert.doesNotMatch(reconcile, /quality: "ESTIMATE"/, "a CJ cost row is still written as an estimate");
  assert.match(reconcile, /costBasis: "CJ_ORDER"/);
  assert.match(reconcile, /costBasis: "CJ_BUNDLE_PRICE"/);
  for (const file of ["public/admin/js/overview.js", "public/admin/js/growth-cockpit.js"]) {
    assert.doesNotMatch(read(file), /estimat/i, `${file} still shows the owner an estimate`);
  }
  // The trailing-average guess is gone from the dashboard entirely.
  assert.doesNotMatch(readFileSync(path.join(root, "src/routes/growth-cockpit.ts"), "utf8"), /trailingCogsPerOrder/);
});

function read(relative: string): string {
  return readFileSync(path.join(root, relative), "utf8");
}
