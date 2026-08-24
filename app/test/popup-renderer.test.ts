import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, "../storefront/popup-renderer.js"), "utf8");

test("renderer is inert until explicitly started", () => {
  assert.match(source, /let started = false/);
  assert.match(source, /window\.TigerPopupRenderer/);
  assert.doesNotMatch(source, /start\(\);\s*\}\)\(\)/);
});

test("renderer builds creative with textContent rather than unsafe HTML", () => {
  assert.match(source, /title\.textContent/);
  assert.match(source, /body\.textContent/);
  assert.doesNotMatch(source, /innerHTML\s*=/);
  assert.doesNotMatch(source, /insertAdjacentHTML/);
});

test("renderer supports local close paths without API dependency", () => {
  assert.match(source, /closeModal\("close_button"\)/);
  assert.match(source, /closeModal\("escape"\)/);
  assert.match(source, /closeModal\("backdrop"\)/);
  assert.match(source, /closeModal\("timeout"\)/);
  assert.match(source, /document\.body\.style\.overflow = current\.previousOverflow/);
  assert.match(source, /current\.previousFocus\.focus/);
});

test("renderer cannot render a popup unless server decision says SHOW", () => {
  assert.match(source, /response\.rendererEnabled && response\.decision && response\.decision\.action === "SHOW"/);
  assert.match(source, /postDecision/);
});

test("renderer treats checkout and existing modal state as conflict signals", () => {
  assert.match(source, /blockingOverlayOpen/);
  assert.match(source, /checkoutInProgress: pageRole === "checkout"/);
  assert.match(source, /supportIntentActive/);
});
