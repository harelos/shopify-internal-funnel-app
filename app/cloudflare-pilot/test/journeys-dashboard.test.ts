import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/admin/journeys.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public/admin/css/journeys.css"), "utf8");
const script = fs.readFileSync(path.join(root, "public/admin/js/journeys.js"), "utf8");

test("customer journeys ship as an authenticated, responsive owner workflow", () => {
  assert.match(html, /meta name="shopify-api-key"/);
  assert.match(html, /See how each purchase happened/);
  assert.match(html, /Missing identity remains clearly marked instead of being guessed/);
  assert.match(script, /\/api\/journeys/);
  assert.match(script, /Asia\/Jerusalem/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /grid-template-columns:\s*1fr/);
});
