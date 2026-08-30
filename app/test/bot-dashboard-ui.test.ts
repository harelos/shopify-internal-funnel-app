import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const html = fs.readFileSync(path.join(root, "admin/bot-dashboard.html"), "utf8");
const css = fs.readFileSync(path.join(root, "admin/css/bot-dashboard.css"), "utf8");
const js = fs.readFileSync(path.join(root, "admin/js/bot-dashboard.js"), "utf8");

function idsInHtml() {
  return [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
}

test("Bot Control dashboard has no duplicate DOM ids", () => {
  const ids = idsInHtml();
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual([...new Set(duplicates)], []);
});

test("dashboard exposes the exact truth hierarchy", () => {
  const order = [
    "Structured Shopify / store facts",
    "Versioned internal knowledge packs",
    "Deterministic business rules",
    "Model-generated prose",
  ];
  let cursor = -1;
  for (const label of order) {
    const next = html.indexOf(label);
    assert.ok(next > cursor, `${label} should appear in authority order`);
    cursor = next;
  }
});

test("dashboard contains the complete operator brain path", () => {
  for (const label of ["ENTRY", "SECURITY CHECK", "INTENT ROUTING", "ROLE", "STATE", "TOOLS / KNOWLEDGE", "ACTION", "ANALYTICS / MEMORY"]) {
    assert.match(html, new RegExp(label.replace("/", "\\/")));
  }
});

test("dashboard remains private and explicitly storefront-off", () => {
  assert.match(html, /Storefront OFF/);
  assert.match(html, /private staging/i);
  assert.doesNotMatch(html, /theme\.liquid|app embed|script_tag/i);
});

test("dashboard reads existing bot APIs rather than inventing operational values", () => {
  for (const endpoint of ["/api/bot/config", "/api/bot/providers/status", "/api/bot/knowledge", "/api/bot/analytics?range=7d"]) {
    assert.match(js, new RegExp(endpoint.replace(/[?]/g, "\\?")));
  }
  assert.match(js, /Promise\.all/);
});

test("dashboard has responsive layouts", () => {
  assert.match(html, /viewport-fit=cover/);
  assert.match(css, /@media\(max-width:980px\)/);
  assert.match(css, /@media\(max-width:680px\)/);
  assert.match(css, /@media\(max-width:420px\)/);
});
