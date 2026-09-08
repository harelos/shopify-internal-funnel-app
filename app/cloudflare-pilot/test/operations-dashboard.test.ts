import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/admin/operations.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public/admin/css/operations.css"), "utf8");
const script = fs.readFileSync(path.join(root, "public/admin/js/operations.js"), "utf8");
const route = fs.readFileSync(path.join(root, "src/routes/operations.ts"), "utf8");

test("Operations is a read-only owner view with direct routes to each system owner", () => {
  assert.match(html, /Is anything broken\?/);
  assert.match(html, /No storefront settings are changed from this screen/);
  for (const href of ["support.html", "element-experiments.html", "growth-cockpit.html", "cart-offers.html"]) {
    assert.match(html, new RegExp(`href="${href}"`));
  }
  assert.doesNotMatch(script, /API\.(?:post|put|patch|del)\(/);
});

test("Operations uses the authenticated health endpoint and refreshes without raw identifiers", () => {
  assert.match(script, /API\.get\("\/api\/operations\/health"\)/);
  assert.match(script, /60_000/);
  assert.match(script, /Never guessed/);
  assert.doesNotMatch(html, /checkoutToken|externalMessageId|shopifyOrderGid/);
  assert.doesNotMatch(script, /checkoutToken|externalMessageId|shopifyOrderGid/);
});

test("Operations backend derives health from authoritative ledgers and fails attribution closed", () => {
  assert.match(route, /ShopifyWebhookDelivery/);
  assert.match(route, /FinancialLedgerCoverage/);
  assert.match(route, /SupportMailbox/);
  assert.match(route, /ElementExposure/);
  assert.match(route, /OrderAttribution/);
  assert.match(route, /will remain unattributed rather than guessed/);
  assert.match(route, /Meta cost coverage is stale/);
  assert.match(route, /probeShopifyPixelHealth\(shopify, sessionToken\)/);
  assert.match(route, /Shopify checkout pixel is not connected/);
  assert.match(script, /Checkout tracking/);
  assert.match(route, /Cache-Control", "no-store/);
});

test("Operations layout is mobile-safe", () => {
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /\.health-grid \{ grid-template-columns: 1fr/);
  assert.match(html, /name="viewport"/);
});
