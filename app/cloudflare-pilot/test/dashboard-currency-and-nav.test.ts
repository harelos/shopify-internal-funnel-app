import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

/**
 * The dashboard reports in one currency. An empty reporting window has no
 * order currency to read, and falling back to the store's shekel printed
 * "₪0.00" on a dollar dashboard.
 */
test("an empty window is still labelled in the reporting currency", () => {
  const analytics = read("src/routes/analytics.ts");
  assert.doesNotMatch(analytics, /displayCurrency === "ILS" \? "₪" : displayCurrency \|\| "₪"/, "still defaults an empty window to shekels");
  const occurrences = analytics.split("const displayCurrency = unconverted || money.currency;").length - 1;
  assert.equal(occurrences, 2, "both the account and funnel reports must label currency the same way");
  assert.match(analytics, /const unconverted = reportedCurrencies\.length === 1 && reportedCurrencies\[0\] !== money\.currency/);
});

test("no dashboard money field falls back to a shekel", () => {
  for (const file of ["public/admin/js/analytics.js", "public/admin/js/funnel.js", "public/admin/analytics.html", "public/admin/funnel.html"]) {
    assert.doesNotMatch(read(file), /₪/, `${file} still hardcodes a shekel`);
  }
});

/**
 * Every destination was visible on every page. Grouping them behind five
 * section labels hid most of the app, so the flat list is what ships.
 */
test("the admin nav lists every destination, not a subset", () => {
  const shell = read("public/admin/js/commerce-os-shell.js");
  assert.doesNotMatch(shell, /commerce-os-subnav/, "the nav still hides pages behind a section");
  for (const page of [
    "index.html", "growth-cockpit.html", "journeys.html", "ai-concierge.html",
    "element-experiments.html", "support.html", "operations.html", "shipment-control.html",
    "cart-offers.html", "popup-analytics.html", "analytics.html", "funnel.html",
  ]) {
    assert.ok(shell.includes(`"${page}"`), `the nav no longer links to ${page}`);
  }
});

test("the pages that carried an in-page section nav still carry it", () => {
  for (const page of ["index.html", "journeys.html", "operations.html", "shipment-control.html"]) {
    const html = read(`public/admin/${page}`);
    assert.match(html, /<nav class="os-nav"/, `${page} lost its section nav`);
    const nav = html.match(/<nav class="os-nav"[\s\S]*?<\/nav>/)?.[0] || "";
    const links = (nav.match(/<a /g) || []).length;
    assert.equal(links, 8, `${page} section nav should list all eight sections`);
    assert.match(nav, /href="live\.html"/, `${page} section nav should link to the live funnel`);
  }
});
