import assert from "node:assert/strict";
import test from "node:test";
import {
  needsOrderReconciliation,
  normalizeShopifyOrderForAttribution,
  reconciliationFinancialUpdate,
  type ExistingOrderAttributionSnapshot,
  type ShopifyOrderForAttributionReconciliation,
} from "../src/lib/shopify-order-reconciliation.ts";
import { extractShopifyStoredContext } from "../src/lib/shopify-stored-context.ts";

function order(overrides: Partial<ShopifyOrderForAttributionReconciliation> = {}): ShopifyOrderForAttributionReconciliation {
  return {
    id: "gid://shopify/Order/4419",
    processedAt: "2026-09-08T08:30:00.000Z",
    test: false,
    cancelledAt: null,
    displayFinancialStatus: "PAID",
    discountCodes: ["NOVA10"],
    currentTotalPriceSet: { shopMoney: { amount: "239.00", currencyCode: "ILS" } },
    netPaymentSet: { shopMoney: { amount: "239.00", currencyCode: "ILS" } },
    customAttributes: [],
    lineItems: { nodes: [] },
    ...overrides,
  };
}

function existing(fields: NonNullable<ReturnType<typeof normalizeShopifyOrderForAttribution>>): ExistingOrderAttributionSnapshot {
  return {
    ...reconciliationFinancialUpdate(fields),
    popupAttributed: false,
    popupVisitorKey: "verified_visitor",
    popupSessionKey: null,
    popupVersion: null,
    popupCouponCode: null,
    popupPage: null,
    popupDevice: null,
    popupUtmSource: null,
    popupUtmMedium: null,
    popupUtmCampaign: null,
    popupAttributionMethod: null,
  };
}

test("normalizes a paid Shopify order into an authoritative revenue row", () => {
  const result = normalizeShopifyOrderForAttribution(order());
  assert.ok(result);
  assert.equal(result.shopifyOrderGid, "gid://shopify/Order/4419");
  assert.equal(result.netRevenueAmount, 239);
  assert.equal(result.currency, "ILS");
  assert.equal(result.isRevenueOrder, true);
  assert.equal(result.popup, null);
});

test("marks refunded orders as closed with zero net revenue", () => {
  const result = normalizeShopifyOrderForAttribution(order({
    displayFinancialStatus: "REFUNDED",
    netPaymentSet: { shopMoney: { amount: "0.00", currencyCode: "ILS" } },
  }));
  assert.ok(result);
  assert.equal(result.status, "REFUNDED_OR_CANCELLED");
  assert.equal(result.netRevenueAmount, 0);
  assert.equal(result.refundedAmount, 239);
  assert.equal(result.isRevenueOrder, false);
});

test("recognizes only an exact persisted Concierge marker", () => {
  const result = normalizeShopifyOrderForAttribution(order({
    customAttributes: [
      { key: "_nh_popup", value: "1" },
      { key: "_nh_visitor_id", value: "visitor_4419" },
      { key: "_nh_version", value: "novahair_ai_v1" },
    ],
  }));
  assert.ok(result?.popup);
  assert.equal(result.popup.visitorId, "visitor_4419");
  assert.equal(result.popup.version, "novahair_ai_v1");
});

test("does not overwrite existing attribution when Shopify has no marker", () => {
  const fields = normalizeShopifyOrderForAttribution(order());
  assert.ok(fields);
  const update = reconciliationFinancialUpdate(fields);
  assert.equal("popupVisitorKey" in update, false);
  assert.equal(needsOrderReconciliation(existing(fields), fields), false);
});

test("detects a financial change without changing attribution", () => {
  const fields = normalizeShopifyOrderForAttribution(order());
  assert.ok(fields);
  const snapshot = existing(fields);
  snapshot.netRevenueAmount = 0;
  assert.equal(needsOrderReconciliation(snapshot, fields), true);
});

test("a partial Shopify marker cannot erase richer verified popup attribution", () => {
  const fields = normalizeShopifyOrderForAttribution(order({
    customAttributes: [{ key: "_nh_popup", value: "1" }],
  }));
  assert.ok(fields);
  const snapshot = existing(fields);
  snapshot.popupAttributed = true;
  snapshot.popupAttributionMethod = "CART_NOTE_ATTRIBUTES";
  const update = reconciliationFinancialUpdate(fields, snapshot);
  assert.equal("popupVisitorKey" in update && update.popupVisitorKey, "verified_visitor");
  assert.equal(needsOrderReconciliation(snapshot, fields), false);
});

test("extracts only the pseudonymous stored cart context used for checkout recovery", () => {
  const stored = extractShopifyStoredContext([
    { key: "email", value: "customer@example.com" },
    {
      key: "__funnel_context__",
      value: JSON.stringify({
        visitorId: "visitor_12345678",
        firstTouch: { utmSource: "facebook", utmCampaign: "roots" },
        elementAssignments: [{ assignmentId: "assignment_123", experimentId: "experiment_123", variantId: "variant_123", slotId: "slot_123456" }],
      }),
    },
  ], "jacobfelipe.myshopify.com");
  assert.equal(stored?.context.visitorId, "visitor_12345678");
  assert.equal(stored?.context.firstTouch?.utmSource, "facebook");
  assert.equal(Array.isArray(stored?.elementAssignments), true);
  assert.equal("email" in (stored?.context || {}), false);
});

test("rejects malformed stored cart context safely", () => {
  assert.equal(extractShopifyStoredContext([{ key: "__funnel_context__", value: "not-json" }], "jacobfelipe.myshopify.com"), null);
});
