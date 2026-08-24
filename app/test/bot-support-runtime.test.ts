import test from "node:test";
import assert from "node:assert/strict";
import {
  extractOrderVerification,
  formatVerifiedTrackingReply,
  missingOrderVerificationReply,
} from "../src/lib/bot-support-runtime.js";

test("extracts order number and email across separate conversation turns", () => {
  const parsed = extractOrderVerification([
    "איפה ההזמנה שלי? מספר הזמנה #12345",
    "האימייל הוא buyer@example.com",
  ]);
  assert.equal(parsed.orderName, "12345");
  assert.equal(parsed.email, "buyer@example.com");
  assert.equal(parsed.phone, null);
});

test("does not mistake a bare order number for a phone number", () => {
  const parsed = extractOrderVerification(["הזמנה 12345"]);
  assert.equal(parsed.orderName, "12345");
  assert.equal(parsed.phone, null);
});

test("requires order number before contact verification", () => {
  const reply = missingOrderVerificationReply({ orderName: null, email: null, phone: null });
  assert.match(String(reply), /מספר ההזמנה/);
});

test("requires email or phone after order number", () => {
  const reply = missingOrderVerificationReply({ orderName: "12345", email: null, phone: null });
  assert.match(String(reply), /אימייל|טלפון/);
});

test("formats only verified tracking facts and avoids invented ETA", () => {
  const reply = formatVerifiedTrackingReply({
    id: "gid://shopify/Order/1",
    name: "#12345",
    displayFinancialStatus: "PAID",
    displayFulfillmentStatus: "FULFILLED",
    createdAt: "2026-08-20T10:00:00Z",
    fulfillments: [{
      status: "SUCCESS",
      deliveredAt: null,
      trackingInfo: [{ company: "Carrier", number: "ABC123", url: "https://example.com/track" }],
    }],
  });
  assert.match(reply, /#12345/);
  assert.match(reply, /ABC123/);
  assert.match(reply, /Carrier/);
  assert.match(reply, /לא מוסיפה הערכת הגעה/);
});
