import assert from "node:assert/strict";
import test from "node:test";
import { auditSupplierCosts, localDateOf } from "../src/lib/cj-cost-audit.js";

const tz = "Asia/Jerusalem";
const sale = (number: string, processedAt: string) => ({ id: `gid://shopify/Order/${number}`, name: `#${number}`, processedAt });
const ledger = (number: string, occurredDate: string, amount: number, basis = "CJ_ORDER") =>
  ({ externalKey: `gid://shopify/Order/${number}`, occurredDate, amount, metadata: JSON.stringify({ costBasis: basis }) });

test("a sale is dated in Israel, not UTC", () => {
  assert.equal(localDateOf("2026-09-16T22:30:00Z", tz), "2026-09-17");
});

/**
 * 2026-09-17: ten rows made $327.37 for five sales. Six were week-old orders
 * re-dated to the day a sweep re-queued them, two of those sales had a second
 * CJ order placed for a parcel already shipped, and one sale had no row at
 * all. The audit is the sentence that would have said so that morning.
 */
test("the audit names every way the ledger disagrees with the sales", () => {
  const report = auditSupplierCosts({
    timezone: tz,
    sales: [
      sale("4481", "2026-09-16T08:00:00Z"),
      sale("4482", "2026-09-17T06:00:00Z"),
      sale("4484", "2026-09-17T08:26:00Z"),
      sale("4414", "2026-09-08T10:00:00Z"),
    ],
    ledgerRows: [
      ledger("4482", "2026-09-17", 34.13, "CJ_BUNDLE_PRICE"),
      ledger("4484", "2026-09-17", 34.13),
      ledger("4414", "2026-09-17", 34.13),
      ledger("9999", "2026-09-17", 34.13),
    ],
    cjRows: [
      { orderId: "a", orderNum: "AUTO-4414", orderStatus: "CREATED", createDate: "2026-09-17 02:11:00" },
      { orderId: "r", orderNum: "RESCUE-4414", orderStatus: "SHIPPED", createDate: "2026-09-08 10:30:00" },
      { orderId: "s", orderNum: "#4484", orderStatus: "CREATED" },
      { orderId: "b", orderNum: "AUTO-4484", orderStatus: "CREATED" },
    ],
  });
  assert.equal(report.sales, 4);
  assert.equal(report.priced, 3);
  assert.equal(report.exact, 2);
  assert.equal(report.bundlePriced, 1);
  assert.deepEqual(report.unpriced, [{ order: "#4481", saleDate: "2026-09-16" }]);
  assert.deepEqual(report.misdated, [{ order: "#4414", saleDate: "2026-09-08", ledgerDate: "2026-09-17", amount: 34.13 }]);
  assert.deepEqual(report.duplicatesAtCj, [{ order: "#4414", cjOrders: ["AUTO-4414", "RESCUE-4414"] }]);
  assert.deepEqual(report.days, [
    { date: "2026-09-08", sales: 1, priced: 1, amount: 34.13 },
    { date: "2026-09-16", sales: 1, priced: 0, amount: 0 },
    { date: "2026-09-17", sales: 2, priced: 2, amount: 68.26 },
  ]);
  assert.equal(report.ok, false);
});

test("a clean week is clean, and a zero row is not a price", () => {
  const clean = auditSupplierCosts({
    timezone: tz,
    sales: [sale("1", "2026-09-17T06:00:00Z")],
    ledgerRows: [ledger("1", "2026-09-17", 20.2)],
    cjRows: [{ orderId: "x", orderNum: "AUTO-1", orderStatus: "CREATED" }],
  });
  assert.equal(clean.ok, true);
  const zero = auditSupplierCosts({
    timezone: tz,
    sales: [sale("1", "2026-09-17T06:00:00Z")],
    ledgerRows: [ledger("1", "2026-09-17", 0)],
    cjRows: null,
  });
  assert.equal(zero.unpriced.length, 1);
  assert.equal(zero.duplicatesAtCj.length, 0, "no CJ list, no duplicate verdict");
});
