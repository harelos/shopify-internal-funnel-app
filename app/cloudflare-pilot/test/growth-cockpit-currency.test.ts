import assert from "node:assert/strict";
import test from "node:test";
import {
  convertFinancialMetric,
  weakerFinancialQuality,
  type FinancialMetric,
  type FxRateQuote,
} from "../src/lib/growth-cockpit-finance.js";

function shopifyRevenue(overrides: Partial<FinancialMetric> = {}): FinancialMetric {
  return {
    amount: 8995.16,
    currency: "ILS",
    quality: "ACTUAL",
    source: "SHOPIFY_ADMIN_ORDERS",
    note: "Shopify net payments.",
    ...overrides,
  };
}

function quote(overrides: Partial<FxRateQuote> = {}): FxRateQuote {
  return {
    base: "ILS",
    quote: "USD",
    rate: 0.329637,
    rateDate: "2026-09-14",
    source: "open.er-api.com",
    quality: "ACTUAL",
    note: "1 ILS = 0.329637 USD published 2026-09-14 by open.er-api.com.",
    ...overrides,
  };
}

test("a store-currency amount is restated in the reporting currency", () => {
  const result = convertFinancialMetric(shopifyRevenue(), "USD", quote());
  assert.equal(result.amount, 2965.14);
  assert.equal(result.currency, "USD");
  assert.equal(result.quality, "ACTUAL");
  assert.equal(result.conversion?.originalAmount, 8995.16);
  assert.equal(result.conversion?.originalCurrency, "ILS");
  assert.equal(result.conversion?.rate, 0.329637);
  assert.equal(result.conversion?.rateDate, "2026-09-14");
  assert.match(result.note, /Converted from ILS/);
});

test("a metric already in the reporting currency is left untouched", () => {
  const metaSpend: FinancialMetric = {
    amount: 893.74,
    currency: "USD",
    quality: "ACTUAL",
    source: "META_ADS_INSIGHTS",
    note: "Meta Insights spend.",
  };
  const result = convertFinancialMetric(metaSpend, "USD", null);
  assert.equal(result.amount, 893.74);
  assert.equal(result.quality, "ACTUAL");
  assert.equal(result.conversion, undefined);
});

test("a stale rate downgrades the converted metric instead of hiding it", () => {
  const result = convertFinancialMetric(shopifyRevenue(), "USD", quote({ quality: "ESTIMATE", rateDate: "2026-09-10" }));
  assert.equal(result.quality, "ESTIMATE");
  assert.equal(result.amount, 2965.14);
  assert.equal(result.conversion?.rateQuality, "ESTIMATE");
});

test("a converted metric is never reported above the quality of its source", () => {
  const result = convertFinancialMetric(shopifyRevenue({ quality: "PARTIAL" }), "USD", quote());
  assert.equal(result.quality, "PARTIAL");
});

test("no published rate fails closed rather than reporting an unconverted amount", () => {
  const result = convertFinancialMetric(shopifyRevenue(), "USD", quote({ rate: null, quality: "MISSING", note: "No ILS/USD rate is available." }));
  assert.equal(result.amount, null);
  assert.equal(result.currency, "USD");
  assert.equal(result.quality, "MISSING");
  assert.match(result.note, /No ILS\/USD rate is available/);
});

test("an unconfigured reporting currency stays unauthoritative", () => {
  const result = convertFinancialMetric(shopifyRevenue(), null, null);
  assert.equal(result.quality, "PARTIAL");
  assert.match(result.note, /REPORTING_CURRENCY is not configured/);
});

test("a missing source amount cannot be conjured by a rate", () => {
  const result = convertFinancialMetric(shopifyRevenue({ amount: null, quality: "MISSING" }), "USD", quote());
  assert.equal(result.amount, null);
  assert.equal(result.quality, "MISSING");
});

test("quality combination keeps the weaker of the two inputs", () => {
  assert.equal(weakerFinancialQuality("ACTUAL", "ESTIMATE"), "ESTIMATE");
  assert.equal(weakerFinancialQuality("PARTIAL", "ACTUAL"), "PARTIAL");
  assert.equal(weakerFinancialQuality("MISSING", "PARTIAL"), "MISSING");
  assert.equal(weakerFinancialQuality("ACTUAL", "ACTUAL"), "ACTUAL");
});
