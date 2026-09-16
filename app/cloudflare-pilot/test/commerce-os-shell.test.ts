import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const admin = path.join(root, "public", "admin");
const shell = readFileSync(path.join(admin, "js", "commerce-os-shell.js"), "utf8");

test("Commerce OS navigation is shared by every owner-facing module", () => {
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

test("Legacy operations routing does not point Commerce OS operations at Cart Offers", () => {
  assert.match(shell, /\["operations\.html", "Operations"\]/);
  assert.doesNotMatch(shell, /\["cart-offers\.html", "Operations"\]/);
});

/**
 * The menu lists every destination at once. Grouping them behind five section
 * labels, so a section only revealed its own pages, hid most of the app from
 * the owner — restored to the flat list on 2026-09-16.
 */
test("every destination is reachable from the menu, exactly once", () => {
  const destinations = [
    "index.html", "growth-cockpit.html", "journeys.html", "analytics.html",
    "popup-analytics.html", "ai-concierge.html", "element-experiments.html",
    "support.html", "shipment-control.html", "operations.html",
    "funnel.html", "cart-offers.html",
  ];
  for (const destination of destinations) {
    const occurrences = shell.split(`["${destination}", `).length - 1;
    assert.equal(occurrences, 1, `${destination} appears ${occurrences} times in the menu`);
  }
  assert.doesNotMatch(shell, /commerce-os-subnav/, "a section-scoped submenu is hiding destinations again");
});

test("one destination, one label", () => {
  const labels = [...shell.matchAll(/\["([a-z-]+\.html)", "([^"]+)"\]/g)];
  const byTarget = new Map<string, Set<string>>();
  for (const [, target, label] of labels) {
    if (!byTarget.has(target)) byTarget.set(target, new Set());
    byTarget.get(target)!.add(label);
  }
  for (const [target, names] of byTarget) {
    assert.equal(names.size, 1, `${target} is labelled ${[...names].join(" and ")}`);
  }
});
