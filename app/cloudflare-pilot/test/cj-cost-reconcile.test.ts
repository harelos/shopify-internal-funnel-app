import assert from "node:assert/strict";
import test from "node:test";
import { matchCjOrders } from "../src/lib/cj-cost-match.js";

test("CJ reconciliation only accepts exact platform and Shopify legacy order ID matches", () => {
  const matches = matchCjOrders([
    { id: "gid://shopify/Order/1", legacyResourceId: "1", processedAt: "2026-08-25T00:00:00Z", netPaymentAmount: 100, currency: "USD" },
    { id: "gid://shopify/Order/2", legacyResourceId: "2", processedAt: "2026-08-25T00:00:00Z", netPaymentAmount: 100, currency: "USD" },
  ], [
    { orderId: "cj-1", platformOrderId: "1" },
    { orderId: "cj-duplicate", platformOrderId: "1" },
    { orderId: "cj-unmatched", platformOrderId: "999" },
  ]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.shopify.id, "gid://shopify/Order/1");
  assert.equal(matches[0]?.cj.orderId, "cj-1");
});
