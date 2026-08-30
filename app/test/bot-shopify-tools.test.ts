import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOrderName, verifyOrderContact } from "../src/lib/bot-shopify-tools.js";

test("order name normalization accepts Shopify display numbers without exposing search syntax", () => {
  assert.equal(normalizeOrderName("#4362"), "4362");
  assert.equal(normalizeOrderName("  #1001-A  "), "1001-A");
  assert.equal(normalizeOrderName("#12:* OR test:true"), "12ORtesttrue");
});

test("verified order contact requires exact normalized email or phone match", () => {
  const order = { id: "gid://shopify/Order/1", name: "#4362", email: "Buyer@Example.com", phone: "+972 50-123-4567" };
  assert.equal(verifyOrderContact(order, { email: "buyer@example.com" }), true);
  assert.equal(verifyOrderContact(order, { phone: "0501234567" }), false);
  assert.equal(verifyOrderContact(order, { phone: "+972501234567" }), true);
  assert.equal(verifyOrderContact(order, { email: "attacker@example.com" }), false);
  assert.equal(verifyOrderContact(order, {}), false);
});

test("order verification never treats partial phone digits as a match", () => {
  const order = { id: "gid://shopify/Order/2", name: "#1", phone: "+972501234567" };
  assert.equal(verifyOrderContact(order, { phone: "1234567" }), false);
});
