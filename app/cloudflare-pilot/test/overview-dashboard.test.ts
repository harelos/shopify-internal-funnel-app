import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/admin/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public/admin/css/overview.css"), "utf8");
const script = fs.readFileSync(path.join(root, "public/admin/js/overview.js"), "utf8");
const rangePicker = fs.readFileSync(path.join(root, "public/admin/js/range-picker.js"), "utf8");
const analytics = fs.readFileSync(path.join(root, "src/routes/analytics.ts"), "utf8");

test("Commerce OS overview keeps every primary product destination working", () => {
  // The menu lives in the shared shell, not in this page, so the destinations
  // are asserted where they are actually defined.
  const shell = fs.readFileSync(path.join(root, "public/admin/js/commerce-os-shell.js"), "utf8");
  for (const [label, href] of [
    ["Overview", "index.html"],
    ["Growth", "growth-cockpit.html"],
    ["Journeys", "journeys.html"],
    ["Experiences", "ai-concierge.html"],
    ["Experiments", "element-experiments.html"],
    ["Support", "support.html"],
    ["Operations", "operations.html"],
  ]) {
    assert.match(shell, new RegExp(`\\["${href}", "${label}"\\]`));
  }
  assert.match(html, /js\/commerce-os-shell\.js/);
});

test("Commerce OS overview reports Shopify truth and mobile-safe layouts", () => {
  assert.match(script, /\/api\/analytics\/account/);
  assert.match(script, /\/api\/element-experiments\//);
  assert.match(script, /experience:\s*"concierge"/);
  // The reporting timezone belongs to the shared window control, so every
  // dashboard resolves identical day boundaries instead of its own.
  assert.match(rangePicker, /Asia\/Jerusalem/);
  assert.match(script, /RangePicker/);
  assert.doesNotMatch(script, /Asia\/Jerusalem/);
  assert.match(html, /Shopify remains the financial source of truth/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /overflow-x:\s*auto/);
});

test("any reporting window can be requested, not only the built-in presets", () => {
  assert.match(html, /id="overview-range"/);
  assert.match(html, /src="js\/range-picker\.js"/);
  for (const preset of ["today", "yesterday", "last_7_days", "last_30_days", "last_90_days", "month_to_date"]) {
    assert.match(rangePicker, new RegExp(`id: "${preset}"`));
  }
  assert.match(rangePicker, /data-preset="custom"/);
  assert.match(rangePicker, /data-role="from"/);
  assert.match(rangePicker, /data-role="to"/);
  // A window that includes today must not claim coverage of hours that have not happened.
  assert.match(rangePicker, /end > now \? now : end/);
});

test("the conversion rate is measured against the population it was observed on", () => {
  // Only the account-level handler is asserted here. A funnel report already
  // scopes both its orders and its visitors to one funnel.
  const accountStart = analytics.indexOf('router.get("/analytics/account"');
  const accountEnd = analytics.indexOf("router.get(", accountStart + 1);
  assert.ok(accountStart >= 0 && accountEnd > accountStart, "account analytics handler not found");
  const accountHandler = analytics.slice(accountStart, accountEnd);
  // Store-wide orders over app-tracked visitors counts buyers the app never saw.
  assert.doesNotMatch(accountHandler, /totalOrders \/ uniqueVisitorIds\.size/);
  assert.match(accountHandler, /convertedVisitorIds\.size \/ uniqueVisitorIds\.size/);
  assert.match(analytics, /conversionCoverage/);
  assert.match(script, /conversionCoverage/);
  assert.match(html, /Tracked conversion/);
});

test("the first screen answers the money questions, not just the traffic ones", () => {
  for (const id of ["revenue", "orders", "conversion", "aov", "spend", "roas", "cogs", "fees", "profit", "becpa"]) {
    assert.match(html, new RegExp(`id="metric-${id}"`), `the ${id} metric is missing from the overview`);
  }
  // They must come from the verified financial contract, for the selected window.
  assert.match(script, /\/api\/growth-cockpit\/finance/);
  assert.match(script, /selectedWindow\.fromLabel/);
  assert.match(script, /selectedWindow\.toLabel/);
});

test("a conversion rate is withheld rather than reported as zero when orders exist", () => {
  assert.match(analytics, /const measurable =/);
  assert.match(analytics, /overallConvRate = measurable/);
  // 0% would describe the business; the truth is that the tracking did not see them.
  assert.match(analytics, /Not measurable:/);
  assert.match(script, /"Not measurable"/);
});

test("the window opens with one health number and shows what produced it", () => {
  assert.match(html, /id="health-panel"/);
  assert.match(html, /id="health-arc"/);
  assert.match(html, /id="health-score"/);
  assert.match(html, /id="health-components"/);
  assert.match(script, /paintHealth/);
  // A period with no verifiable input must leave the arc empty rather than
  // drawing a confident zero.
  assert.match(script, /scored \? HEALTH_ARC_LENGTH \* \(1 - health\.score \/ 100\) : HEALTH_ARC_LENGTH/);
  assert.match(css, /\.health-panel\[data-band="critical"\]/);
  assert.match(css, /\.health-panel\[data-band="excellent"\]/);
});

test("cart offer performance is measured, and says what it was measured against", () => {
  assert.match(html, /id="metric-takerate"/);
  assert.match(html, /id="offer-rows"/);
  assert.match(script, /growth-cockpit\/take-rates/);
  const takeRate = fs.readFileSync(path.join(root, "src/services/offer-take-rate.ts"), "utf8");
  // Offer SKUs come from the published configuration, never from a constant.
  assert.match(takeRate, /CartOfferConfig/);
  assert.doesNotMatch(takeRate, /gid:\/\/shopify\/ProductVariant\/\d/);
  assert.match(takeRate, /denominator: "PAID_ORDERS"/);
});

test("shipment risk is visible on the screen the owner opens first", () => {
  assert.match(html, /id="metric-risk"/);
  assert.match(html, /id="attention-rows"/);
  assert.match(script, /\/api\/operations\/health/);
  // Critical incidents must sort above warnings, not appear in arrival order.
  assert.match(script, /rank\[a\.severity\]/);
  assert.match(css, /\.offer-row\[data-severity="CRITICAL"\]/);
});
