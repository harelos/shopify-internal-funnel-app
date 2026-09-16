import assert from "node:assert/strict";
import test from "node:test";
import { matchCjOrders } from "../src/lib/cj-cost-match.js";

test("CJ reconciliation only accepts exact platform and Shopify legacy order ID matches", () => {
  const matches = matchCjOrders([
    { id: "gid://shopify/Order/1", legacyResourceId: "1", processedAt: "2026-08-25T00:00:00Z", netPaymentAmount: 100, currency: "USD" },
    { id: "gid://shopify/Order/2", legacyResourceId: "2", processedAt: "2026-08-25T00:00:00Z", netPaymentAmount: 100, currency: "USD" },
  ], [
    { orderId: "cj-1", platformOrderId: "1", orderAmount: 34.13 },
    { orderId: "cj-duplicate", platformOrderId: "1", orderAmount: 34.13 },
    { orderId: "cj-unmatched", platformOrderId: "999", orderAmount: 34.13 },
  ]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.shopify.id, "gid://shopify/Order/1");
  assert.equal(matches[0]?.cj.orderId, "cj-1");
});

test("CJ rows are matched by the order number CJ actually carries", () => {
  // CJ returns no platformOrderId for this store: 30 orders in a week scanned,
  // 199 CJ rows, zero matches. The worker files the fulfilled order as
  // RESCUE-{number}; the store connection leaves a "#{number}" shadow with no
  // amount.
  const shopify = [
    { id: "gid://shopify/Order/7479184163111", legacyResourceId: "7479184163111", name: "#4452", processedAt: "2026-09-14T14:39:45Z", netPaymentAmount: 289, currency: "ILS" },
    { id: "gid://shopify/Order/7479477928231", legacyResourceId: "7479477928231", name: "#4454", processedAt: "2026-09-14T17:36:20Z", netPaymentAmount: 189, currency: "ILS" },
  ];
  const matches = matchCjOrders(shopify, [
    { orderId: "2609141439550660900", orderNum: "#4452", orderStatus: "CREATED", orderAmount: null },
    { orderId: "2609141444500660900", orderNum: "RESCUE-4452", orderStatus: "CREATED", orderAmount: 34.13 },
    { orderId: "2609141736290656300", orderNum: "#4454", orderStatus: "CREATED", orderAmount: null },
    { orderId: "2609141744480652300", orderNum: "RESCUE-4454", orderStatus: "CANCELLED", orderAmount: 20.2 },
    { orderId: "2609141744480652301", orderNum: "RESCUE-4454", orderStatus: "CREATED", orderAmount: 20.2 },
    { orderId: "cj-other-store", orderNum: "RESCUE-9999", orderStatus: "CREATED", orderAmount: 50 },
  ]);
  assert.deepEqual(
    matches.map(match => [match.shopify.name, match.cj.orderId, match.cj.orderAmount]),
    [["#4452", "2609141444500660900", 34.13], ["#4454", "2609141744480652301", 20.2]],
  );
});

test("a shadow row is not taken as the cost when the rescue order carries it", () => {
  const shopify = [
    { id: "gid://shopify/Order/1", legacyResourceId: "1", name: "#4400", processedAt: "2026-09-10T00:00:00Z", netPaymentAmount: 100, currency: "ILS" },
  ];
  // Shadow listed first, as CJ returns them newest-first.
  const matches = matchCjOrders(shopify, [
    { orderId: "shadow", orderNum: "#4400", orderAmount: 0 },
    { orderId: "rescue", orderNum: "RESCUE-4400", orderAmount: 31.5 },
  ]);
  assert.equal(matches[0]?.cj.orderId, "rescue");
});
