import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { convertFinancialMetric, type FinancialMetric, type FxRateQuote } from "../src/lib/growth-cockpit-finance.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

test("a converted amount carries both sides of the rate", () => {
  const metric: FinancialMetric = {
    amount: 288.99,
    currency: "ILS",
    quality: "ACTUAL",
    source: "SHOPIFY_ADMIN_ORDERS",
    note: "Shopify net payments.",
  };
  const quote: FxRateQuote = {
    base: "ILS",
    quote: "USD",
    rate: 0.329637,
    rateDate: "2026-09-14",
    source: "open.er-api.com",
    quality: "ACTUAL",
    note: "",
  };
  const converted = convertFinancialMetric(metric, "USD", quote);
  // Without the original and the rate, a reader cannot check the number.
  assert.equal(converted.conversion?.originalAmount, 288.99);
  assert.equal(converted.conversion?.originalCurrency, "ILS");
  assert.equal(converted.conversion?.quoteCurrency, "USD");
  assert.equal(converted.conversion?.rate, 0.329637);
  assert.equal(converted.conversion?.rateDate, "2026-09-14");
  assert.equal(converted.conversion?.rateSource, "open.er-api.com");
});

test("the shared money helper states the original, the rate and the caveat", () => {
  const money = read("public/admin/js/money.js");
  assert.match(money, /function conversionTitle/);
  assert.match(money, /converted at/);
  assert.match(money, /published/);
  // Shopify settles in the store currency, so the hover has to say the figure
  // stands on a published daily rate and is not a bank balance.
  assert.match(money, /that day's published rate and is not a bank balance/);
  // Nothing was converted means no tooltip, rather than an empty one.
  assert.match(money, /if \(!conversion \|\| conversion\.rate == null\) return null;/);
});

test("every screen that shows converted money loads the helper", () => {
  for (const page of ["index.html", "growth-cockpit.html", "journeys.html", "analytics.html"]) {
    assert.match(read(`public/admin/${page}`), /js\/money\.js/, `${page} cannot explain its conversions`);
  }
});

test("the amounts themselves carry the explanation, not a page footnote", () => {
  const overview = read("public/admin/js/overview.js");
  assert.match(overview, /window\.Money\.explain\(byId\(`metric-\$\{id\}`\), conversion\)/);
  assert.match(overview, /revenue\.conversion/);
  assert.match(overview, /metrics\.paymentFees\?\.conversion/);

  const journeys = read("public/admin/js/journeys.js");
  assert.match(journeys, /conversionAttr\(journey\.conversion\)/);
  // The order list shows what the shopper was actually charged.
  assert.match(journeys, /charged/);

  const insights = read("public/admin/js/growth-cockpit.js");
  assert.match(insights, /window\.Money\.conversionTitle\(conversion\)/);

  const analytics = read("public/admin/js/analytics.js");
  assert.match(analytics, /function explainConversion/);
  assert.match(analytics, /explainConversion\(metricRevenue, report\.totalRevenue, report\)/);
});

test("each order in the list explains its own conversion", () => {
  const route = read("src/routes/journeys.ts");
  assert.match(route, /originalAmount: journey\.revenue/);
  assert.match(route, /rateSource: quote\.source/);
});

test("Insights no longer claims payment fees are excluded", () => {
  const insights = read("public/admin/js/growth-cockpit.js");
  // Profit now nets payment fees, so a card reading EXCLUDED contradicted the
  // figure printed beside it.
  assert.doesNotMatch(insights, /'EXCLUDED'/);
  assert.doesNotMatch(insights, /Not included in current profit calculation/);
  assert.doesNotMatch(insights, /CM1 before payment fees/);
  assert.match(insights, /const netOf = feesIn \? 'after payment fees' : 'before payment fees'/);
  assert.match(insights, /financialCard\('productCost', 'Product cost'/);
});

test("cart offer take-rates are counts, so nothing there needs converting", () => {
  const takeRate = read("src/services/offer-take-rate.ts");
  // If a money field is ever added here it must be converted like the rest.
  assert.doesNotMatch(takeRate, /netRevenueAmount|revenue:/);
  assert.match(takeRate, /denominator: "PAID_ORDERS"/);
});
