import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildAdaptiveResults, normalizeAllocations, variantFromLineItems } from "../src/lib/adaptive-experiments.js";

const KEYS = ["control", "value_delta", "shade_rescue", "scroll_rescue", "full_adaptive"];

describe("normalizeAllocations", () => {
  it("accepts a 60/10/10/10/10 split in flag order", () => {
    const rows = normalizeAllocations([
      { key: "full_adaptive", percentage: 10 }, { key: "control", percentage: 60 }, { key: "value_delta", percentage: 10 },
      { key: "shade_rescue", percentage: 10 }, { key: "scroll_rescue", percentage: 10 },
    ], KEYS);
    assert.deepEqual(rows.map(row => row.key), KEYS);
    assert.equal(rows[0].percentage, 60);
  });
  it("refuses a split that does not reach 100", () => {
    assert.throws(() => normalizeAllocations(KEYS.map(key => ({ key, percentage: 10 })), KEYS), /add up to 50/);
  });
  it("accepts a two-arm 50/50 with the unused variants parked at zero", () => {
    const rows = normalizeAllocations([
      { key: "control", percentage: 50 }, { key: "value_delta", percentage: 0 }, { key: "shade_rescue", percentage: 0 },
      { key: "scroll_rescue", percentage: 0 }, { key: "full_adaptive", percentage: 50 },
    ], KEYS);
    assert.deepEqual(rows.map(row => row.percentage), [50, 0, 0, 0, 50]);
  });
  it("accepts an all-off split so the test can be switched off from the panel", () => {
    const rows = normalizeAllocations(KEYS.map(key => ({ key, percentage: key === "control" ? 100 : 0 })), KEYS);
    assert.equal(rows[0].percentage, 100);
  });
  it("refuses unknown, missing and fractional variants", () => {
    assert.throws(() => normalizeAllocations([{ key: "nope", percentage: 100 }], KEYS), /Unknown variant/);
    assert.throws(() => normalizeAllocations([{ key: "control", percentage: 100 }], KEYS), /missing/);
    assert.throws(() => normalizeAllocations(KEYS.map((key, i) => ({ key, percentage: i === 0 ? 60.5 : 9.875 })), KEYS), /whole number/);
  });
});

describe("variantFromLineItems", () => {
  it("reads the variant off any line item and ignores other properties", () => {
    const variant = variantFromLineItems([
      { customAttributes: [{ key: "_NOVASALE_CONFIG", value: "NOVASALE-4-4-0-0-0-0" }] },
      { customAttributes: [{ key: "_nova_cro_variant", value: "value_delta" }] },
    ]);
    assert.equal(variant, "value_delta");
    assert.equal(variantFromLineItems([{ customAttributes: [] }]), null);
  });
});

describe("buildAdaptiveResults", () => {
  const variants = KEYS.map(key => ({ key, percentage: 20 }));
  it("joins exposures to paid orders by variant and computes rates", () => {
    const results = buildAdaptiveResults({
      variants,
      exposures: [{ variant: "control", visitors: 200, addToCart: 40, checkout: 20 }, { variant: "value_delta", visitors: 100, addToCart: 30, checkout: 15 }],
      orders: [
        { orderId: "1", variant: "control", amount: 239, currency: "ILS", cancelled: false },
        { orderId: "2", variant: "control", amount: 189, currency: "ILS", cancelled: false },
        { orderId: "3", variant: "value_delta", amount: 239, currency: "ILS", cancelled: false },
        { orderId: "4", variant: "value_delta", amount: 239, currency: "ILS", cancelled: true },
        { orderId: "5", variant: null, amount: 319, currency: "ILS", cancelled: false },
      ],
    });
    const control = results.variants.find(row => row.key === "control")!;
    const delta = results.variants.find(row => row.key === "value_delta")!;
    assert.equal(control.orders, 2);
    assert.equal(control.revenue, 428);
    assert.equal(control.conversionRate, 0.01);
    assert.equal(control.revenuePerVisitor, 2.14);
    assert.equal(delta.orders, 1, "a cancelled order does not count");
    assert.equal(delta.revenuePerVisitor, 2.39);
    assert.equal(delta.revenuePerVisitorUpliftPercent, 11.7);
    assert.equal(results.totals.unattributedOrders, 1, "orders without the property are reported, not hidden");
    assert.equal(results.currency, "ILS");
    assert.equal(results.enoughData, false);
  });
  it("counts an order once even if it appears twice", () => {
    const results = buildAdaptiveResults({
      variants,
      exposures: [{ variant: "control", visitors: 10, addToCart: 0, checkout: 0 }],
      orders: [
        { orderId: "same", variant: "control", amount: 239, currency: "ILS", cancelled: false },
        { orderId: "same", variant: "control", amount: 239, currency: "ILS", cancelled: false },
      ],
    });
    assert.equal(results.variants[0].orders, 1);
    assert.equal(results.variants[0].revenue, 239);
  });
  it("flags mixed currencies instead of adding them", () => {
    const results = buildAdaptiveResults({
      variants,
      exposures: [],
      orders: [
        { orderId: "a", variant: "control", amount: 10, currency: "ILS", cancelled: false },
        { orderId: "b", variant: "control", amount: 10, currency: "USD", cancelled: false },
      ],
    });
    assert.equal(results.mixedCurrencies, true);
    assert.equal(results.currency, null);
  });
});
