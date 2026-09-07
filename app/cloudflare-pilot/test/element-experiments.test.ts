import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeGalleryPayload } from "../src/lib/element-templates.js";
import { canReuseElementAssignment, chooseElementVariant, elementBucket } from "../src/services/element-ab-engine.js";
import { buildElementExperimentResults } from "../src/services/element-results.js";

test("gallery control preserves the existing element without accepting arbitrary markup", () => {
  assert.deepEqual(normalizeGalleryPayload({ preserveExisting: true, html: "<script>alert(1)</script>" }), {
    preserveExisting: true,
    initialIndex: 0,
    showThumbnails: true,
    items: [],
  });
});

test("gallery challenger normalizes a safe responsive image payload", () => {
  const payload = normalizeGalleryPayload({
    initialIndex: 9,
    showThumbnails: false,
    items: [
      { id: "proof-1", src: "https://cdn.shopify.com/image.jpg", alt: "NOVAHAIR bottles", caption: "What arrives" },
    ],
  });
  assert.equal(payload.initialIndex, 0);
  assert.equal(payload.showThumbnails, false);
  assert.equal(payload.items[0].id, "proof-1");
});

test("gallery challenger rejects insecure URLs and duplicate image ids", () => {
  assert.throws(() => normalizeGalleryPayload({ items: [{ id: "one", src: "http://example.com/a.jpg", alt: "A" }] }), /HTTPS/);
  assert.throws(() => normalizeGalleryPayload({
    items: [
      { id: "same", src: "/a.jpg", alt: "A" },
      { id: "same", src: "/b.jpg", alt: "B" },
    ],
  }), /duplicated/);
});

test("element assignment bucket is deterministic and honors basis-point boundaries", () => {
  assert.equal(elementBucket("visitor-1", "experiment-1", 1), elementBucket("visitor-1", "experiment-1", 1));
  const allocations = [
    { variantId: "a-control", weightBasisPoints: 5000 },
    { variantId: "b-challenger", weightBasisPoints: 5000 },
  ];
  assert.equal(chooseElementVariant(allocations, 0), "a-control");
  assert.equal(chooseElementVariant(allocations, 4999), "a-control");
  assert.equal(chooseElementVariant(allocations, 5000), "b-challenger");
  assert.equal(chooseElementVariant(allocations, 9999), "b-challenger");
});

test("element assignments are reused only for the current allocation version and an active variant", () => {
  const allocations = [
    { variantId: "control", weightBasisPoints: 0 },
    { variantId: "winner", weightBasisPoints: 10000 },
  ];
  assert.equal(canReuseElementAssignment({ variantId: "winner", allocationVersion: 2 }, 2, allocations), true);
  assert.equal(canReuseElementAssignment({ variantId: "control", allocationVersion: 2 }, 2, allocations), false);
  assert.equal(canReuseElementAssignment({ variantId: "winner", allocationVersion: 1 }, 2, allocations), false);
});

test("sales results use unique visitors and paid non-test net revenue", () => {
  const results = buildElementExperimentResults({
    variants: [
      { id: "control", key: "control", name: "Control", isControl: true },
      { id: "variant-b", key: "variant-b", name: "Variant B", isControl: false },
    ],
    exposures: [
      { visitorId: "c1", variantId: "control", isInternal: false },
      { visitorId: "c1", variantId: "control", isInternal: false },
      { visitorId: "c2", variantId: "control", isInternal: false },
      { visitorId: "b1", variantId: "variant-b", isInternal: false },
      { visitorId: "b2", variantId: "variant-b", isInternal: false },
      { visitorId: "internal", variantId: "variant-b", isInternal: true },
    ],
    checkouts: [
      { checkoutToken: "cc", visitorId: "c1", variantId: "control" },
      { checkoutToken: "bc1", visitorId: "b1", variantId: "variant-b" },
      { checkoutToken: "bc2", visitorId: "b1", variantId: "variant-b" },
    ],
    orders: [
      { orderId: "co", variantId: "control", currency: "ILS", netRevenueAmount: 100, isTest: false, status: "PAID" },
      { orderId: "bo1", variantId: "variant-b", currency: "ILS", netRevenueAmount: 120, isTest: false, status: "PAID" },
      { orderId: "bo2", variantId: "variant-b", currency: "ILS", netRevenueAmount: 120, isTest: false, status: "PAID" },
      { orderId: "test", variantId: "variant-b", currency: "ILS", netRevenueAmount: 999, isTest: true, status: "PAID" },
      { orderId: "refund", variantId: "variant-b", currency: "ILS", netRevenueAmount: 0, isTest: false, status: "REFUNDED_OR_CANCELLED" },
    ],
  });
  const control = results.variants.find(row => row.variantId === "control")!;
  const challenger = results.variants.find(row => row.variantId === "variant-b")!;
  assert.equal(control.exposedVisitors, 2);
  assert.equal(control.conversionRate, 50);
  assert.equal(challenger.orders, 2);
  assert.equal(challenger.checkouts, 2);
  assert.equal(challenger.checkoutVisitors, 1);
  assert.equal(challenger.checkoutRate, 50);
  assert.equal(challenger.revenue, 240);
  assert.equal(challenger.conversionRate, 100);
  assert.equal(challenger.conversionUpliftPercent, 100);
});

test("sales results never sum revenue across currencies", () => {
  const results = buildElementExperimentResults({
    variants: [{ id: "control", key: "control", name: "Control", isControl: true }],
    exposures: [{ visitorId: "v1", variantId: "control", isInternal: false }],
    checkouts: [],
    orders: [
      { orderId: "ils", variantId: "control", currency: "ILS", netRevenueAmount: 100, isTest: false, status: "PAID" },
      { orderId: "usd", variantId: "control", currency: "USD", netRevenueAmount: 10, isTest: false, status: "PAID" },
    ],
  });
  assert.equal(results.mixedCurrencies, true);
  assert.equal(results.variants[0].revenue, null);
  assert.deepEqual(results.variants[0].revenueByCurrency, { ILS: 100, USD: 10 });
});
