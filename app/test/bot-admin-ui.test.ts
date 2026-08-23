import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const html = fs.readFileSync(path.join(root, "admin/bot.html"), "utf8");
const js = fs.readFileSync(path.join(root, "admin/js/bot.js"), "utf8");
const css = fs.readFileSync(path.join(root, "admin/css/bot.css"), "utf8");

function idsInHtml() {
  return [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
}

test("Bot Studio has no duplicate DOM ids", () => {
  const ids = idsInHtml();
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual([...new Set(duplicates)], []);
});

test("all literal bot.js id lookups exist in Bot Studio HTML", () => {
  const ids = new Set(idsInHtml());
  const referenced = [...js.matchAll(/\$\("([A-Za-z0-9_-]+)"\)/g)].map(match => match[1]);
  const missing = [...new Set(referenced.filter(id => !ids.has(id)))];
  assert.deepEqual(missing, []);
});

test("Bot Studio exposes every core private-admin section", () => {
  for (const section of ["overview", "routing", "knowledge", "offers", "models", "crm", "security", "simulator", "analytics"]) {
    assert.match(html, new RegExp(`data-panel="${section}"`));
    assert.match(html, new RegExp(`data-section="${section}"`));
  }
});

test("Bot Studio remains explicitly non-storefront in this batch", () => {
  assert.match(html, /Storefront off/i);
  assert.match(html, /Nothing on this page injects a widget into the storefront/i);
  assert.doesNotMatch(html, /theme\.liquid|script_tag|app embed/i);
});

test("Bot Studio has mobile viewport and dedicated responsive breakpoints", () => {
  assert.match(html, /name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/);
  assert.match(css, /@media\(max-width:820px\)/);
  assert.match(css, /@media\(max-width:520px\)/);
  assert.match(css, /grid-template-columns:1fr/);
});

test("chat trust UI includes profile, typing, composer and trust line", () => {
  assert.match(html, /id="preview-avatar"/);
  assert.match(html, /id="preview-trust"/);
  assert.match(html, /id="sim-input"/);
  assert.match(css, /\.bot-typing/);
  assert.match(css, /\.bot-avatar/);
});
