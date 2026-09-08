import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/admin/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public/admin/css/overview.css"), "utf8");
const script = fs.readFileSync(path.join(root, "public/admin/js/overview.js"), "utf8");

test("Commerce OS overview keeps every primary product destination working", () => {
  for (const [label, href] of [
    ["Overview", "index.html"],
    ["Insights", "growth-cockpit.html"],
    ["Journeys", "analytics.html"],
    ["Experiences", "ai-concierge.html"],
    ["Experiments", "element-experiments.html"],
    ["Support", "support.html"],
    ["Operations", "cart-offers.html"],
  ]) {
    assert.match(html, new RegExp(`href="${href}"[^>]*>${label}<`));
  }
});

test("Commerce OS overview reports Shopify truth and mobile-safe layouts", () => {
  assert.match(script, /\/api\/analytics\/account/);
  assert.match(script, /\/api\/element-experiments\//);
  assert.match(script, /experience:\s*"concierge"/);
  assert.match(script, /Asia\/Jerusalem/);
  assert.match(html, /Shopify remains the financial source of truth/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /overflow-x:\s*auto/);
});
