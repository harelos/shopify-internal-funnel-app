import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

test("every screen that shows money converts it the same way", () => {
  // Revenue is charged in shekels and ad spend is billed in dollars, so a
  // screen mixing them could not be compared with itself.
  for (const file of [
    "src/routes/analytics.ts",
    "src/routes/journeys.ts",
    "src/routes/popup-analytics.ts",
    "src/routes/element-experiments.ts",
  ]) {
    assert.match(read(file), /reportingMoneyFor/, `${file} still reports raw store amounts`);
  }
});

test("the converter never invents a rate it does not have", () => {
  const lib = read("src/lib/reporting-currency.ts");
  // A failed conversion returns null so the caller can keep the store
  // currency, rather than printing a shekel amount with a dollar sign.
  assert.match(lib, /if \(!quote \|\| quote\.rate == null\) return null;/);
  assert.match(lib, /REPORTING_CURRENCY/);
  // The rate used is reported alongside the amount.
  assert.match(lib, /rates: FxRateResolution\[\]/);
});

test("analytics reports the currency it converted to, and says when it could not", () => {
  const analytics = read("src/routes/analytics.ts");
  assert.match(analytics, /const converted = reportedCurrencies[.]length === 1 && reportedCurrencies/);
  assert.match(analytics, /currencySymbol: displaySymbol/);
  assert.match(analytics, /reportingCurrency: displayCurrency/);
  assert.match(analytics, /currencyConverted: converted/);
  // A hard-coded shekel symbol would contradict a converted amount.
  assert.doesNotMatch(analytics, /currencySymbol: "₪"/);
  assert.match(analytics, /totalRevenue: asMoney\(totalRevenue\)/);
  assert.match(analytics, /aov: asMoney\(aov\)/);
});

test("the dashboard formats the currency the server reported, not a fixed one", () => {
  const overview = read("public/admin/js/overview.js");
  const journeys = read("public/admin/js/journeys.js");
  // A Hebrew-locale shekel formatter printed every amount as ILS whatever the
  // server had converted it to.
  assert.doesNotMatch(overview, /currency: "ILS"/);
  assert.doesNotMatch(journeys, /he-IL/);
  assert.match(overview, /if \(data\.reportingCurrency\) reportingCurrency = data\.reportingCurrency/);
});

test("per-order conversion is what the totals are built from", () => {
  // Converting a sum at one rate and the lines at another makes the list
  // disagree with its own total.
  assert.match(read("src/routes/journeys.ts"), /const converted = money\.convert\(journey\.revenue, journey\.currency\)/);
  assert.match(read("src/routes/popup-analytics.ts"), /popupMoney\.convert\(order\.netRevenueAmount, order\.currency\)/);
  assert.match(read("src/routes/element-experiments.ts"), /experimentMoney\.convert\(attribution\.order\.netRevenueAmount, attribution\.order\.currency\)/);
});

test("the storefront keeps charging in the store currency", () => {
  // Only the dashboard is restated. Cart offers show the price a shopper is
  // actually charged, which is still the Shopify store price.
  const cartOffers = read("public/admin/js/cart-offers.js");
  assert.match(cartOffers, /storefrontPriceIls/);
  assert.doesNotMatch(read("src/lib/reporting-currency.ts"), /storefront|checkout|presentment/i);
});

test("orders in two store currencies are never added together raw", () => {
  const analytics = read("src/routes/analytics.ts");
  // The shop's currency was switched from USD to ILS partway through the
  // year, so a thirty-day total was the sum of two different currencies.
  assert.match(analytics, /const restated = money\.convert\(order\.netRevenueAmount, order\.currency\)/);
  assert.doesNotMatch(analytics, /const orders = rawOrders\.filter\(isReportableRevenueOrder\);/);
});

test("a window spanning the currency change still reports a total", () => {
  const route = read("src/routes/growth-cockpit.ts");
  const admin = read("src/lib/shopify-admin.ts");
  // Reporting no amount at all quietly dropped the dashboard back onto stale
  // webhook rows, which read as a revenue collapse.
  assert.match(admin, /const byCurrency = currencies\.map/);
  assert.match(route, /async function restateSummaryCurrency/);
  assert.match(route, /\.then\(restateSummaryCurrency\)/);
  // Settled days are converted individually, at the rate for their own day.
  assert.match(route, /const convertRows = \(rows: typeof revenueRows\)/);
});
