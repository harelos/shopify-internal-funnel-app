import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const admin = path.join(root, "public", "admin");

test("Commerce OS navigation is shared by every owner-facing module", () => {
  const shell = readFileSync(path.join(admin, "js", "commerce-os-shell.js"), "utf8");
  const css = readFileSync(path.join(admin, "css", "commerce-os.css"), "utf8");
  for (const target of ["index.html", "growth-cockpit.html", "journeys.html", "ai-concierge.html", "element-experiments.html", "support.html", "operations.html", "shipment-control.html"]) {
    assert.match(shell, new RegExp(`\\["${target}"`));
  }
  assert.match(css, /overflow-x: auto/);
  assert.match(css, /@media \(max-width: 640px\)/);
});

test("Every live Commerce OS screen includes the responsive shared shell", () => {
  for (const page of [
    "index.html", "growth-cockpit.html", "journeys.html", "ai-concierge.html",
    "element-experiments.html", "support.html", "operations.html", "shipment-control.html",
    "cart-offers.html", "popup-analytics.html", "analytics.html", "funnel.html", "editor.html",
  ]) {
    const html = readFileSync(path.join(admin, page), "utf8");
    assert.match(html, /css\/commerce-os\.css/);
    assert.match(html, /js\/commerce-os-shell\.js/);
  }
});

test("Legacy operations routing does not point Commerce OS journeys at Cart Offers", () => {
  const html = readFileSync(path.join(admin, "journeys.html"), "utf8");
  assert.match(html, /href="operations\.html">Operations/);
  assert.doesNotMatch(html, /href="cart-offers\.html">Operations/);
});
