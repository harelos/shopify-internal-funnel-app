import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const html = fs.readFileSync(path.join(root, "admin/commerce-intelligence.html"), "utf8");
const js = fs.readFileSync(path.join(root, "admin/js/commerce-intelligence.js"), "utf8");
const css = fs.readFileSync(path.join(root, "admin/css/commerce-intelligence.css"), "utf8");
const server = fs.readFileSync(path.join(root, "src/server.ts"), "utf8");

function idsInHtml() {
  return [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
}

test("Commerce Intelligence dashboard has no duplicate DOM ids", () => {
  const ids = idsInHtml();
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual([...new Set(duplicates)], []);
});

test("dashboard exposes the clean KPI sequence", () => {
  for (const label of ["Qualified Sessions", "Landing → Checkout", "Checkout → Purchase", "Landing → Purchase", "Revenue / Qualified Session"]) {
    assert.match(html, new RegExp(label.replace(/[→]/g, "→")));
  }
});

test("dashboard explicitly keeps unknown traffic outside qualified KPI", () => {
  assert.match(html, /Missing context stays UNKNOWN instead of being guessed/i);
  assert.match(html, /Unknown is not zero and not qualified/i);
  assert.match(js, /Unknown sessions remain outside the clean denominator/i);
});

test("dashboard reads the qualified commerce endpoint", () => {
  assert.match(js, /\/api\/commerce-intelligence\/qualified-traffic/);
  assert.match(server, /commerceIntelligenceRoutes/);
});

test("dashboard is responsive", () => {
  assert.match(html, /viewport-fit=cover/);
  assert.match(css, /@media\(max-width:900px\)/);
  assert.match(css, /@media\(max-width:650px\)/);
  assert.match(css, /@media\(max-width:420px\)/);
});
