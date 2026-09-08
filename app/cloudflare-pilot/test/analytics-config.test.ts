import assert from "node:assert/strict";
import test from "node:test";
import { isReportableRevenueOrder } from "../src/lib/analytics-config.js";

test("owner-facing revenue metrics count paid positive-net orders only", () => {
  assert.equal(isReportableRevenueOrder({ netRevenueAmount: 239, status: "PAID" }), true);
  assert.equal(isReportableRevenueOrder({ netRevenueAmount: 0, status: "REFUNDED_OR_CANCELLED" }), false);
  assert.equal(isReportableRevenueOrder({ netRevenueAmount: 0, status: "PAID" }), false);
});
