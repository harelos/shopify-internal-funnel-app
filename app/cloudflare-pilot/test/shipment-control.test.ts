import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const route = fs.readFileSync(path.join(root, "src/routes/shipment-control.ts"), "utf8");
const html = fs.readFileSync(path.join(root, "public/admin/shipment-control.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public/admin/css/shipment-control.css"), "utf8");
const script = fs.readFileSync(path.join(root, "public/admin/js/shipment-control.js"), "utf8");

test("Shipment bridge is token-gated and stores only the reporting whitelist", () => {
  assert.match(route, /SHIPMENT_BRIDGE_TOKEN/);
  assert.match(route, /constantTimeEqual/);
  assert.match(route, /schemaVersion/);
  assert.doesNotMatch(route, /shippingAddress|shippingPhone|shippingCustomerName|customerEmail/);
  assert.doesNotMatch(html + script, /shippingAddress|shippingPhone|customerEmail/);
});

test("Shipment workflow is approval-gated and auditable", () => {
  assert.match(route, /ShipmentActionLog/);
  assert.match(route, /WORKFLOW_STATES/);
  assert.match(script, /Human approval remains required/);
  assert.doesNotMatch(script, /API\.(?:post|patch)\([^\n]*(?:refund|cancel-order|pay-cj|send-message)/i);
});

test("Shipment owner view makes priority, action and contact target explicit", () => {
  assert.match(html, /What needs action today\?/);
  assert.match(html, /Contact CJ/);
  assert.match(html, /Update customer/);
  assert.match(script, /order\.doNow/);
  assert.match(script, /order\.contactTarget/);
  assert.match(script, /Verified by Shopify \+ CJ/);
});

test("Shipment layout is mobile-safe", () => {
  assert.match(html, /name="viewport"/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /\.shipment-card \{ padding: 16px; grid-template-columns: 1fr/);
  assert.match(css, /\.workflow-actions \{ display: flex/);
});
