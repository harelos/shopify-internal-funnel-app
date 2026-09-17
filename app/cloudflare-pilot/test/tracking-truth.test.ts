import assert from "node:assert/strict";
import test from "node:test";
import { evaluateSupportPolicy } from "../src/lib/support-policy.js";
import { deterministicLowRiskDecision } from "../src/lib/support-replies.js";
import { normalizeCjTracking } from "../src/lib/cj-tracking.js";
import { arrivedIsraelText, delayText, giftText } from "../src/lib/shipment-outreach-text.js";

const NOW = new Date("2026-09-15T14:00:00Z");

const IN_ISRAEL = normalizeCjTracking({
  trackingNumber: "95054578", trackingStatus: "En Route", cjMailNo: "CJPAQZ6280600013YQ",
  routes: [
    { acceptAddress: "ISRAEL", acceptTime: "2026-09-15 12:56:59", remark: "Parcel prepared to be sent to pickup point" },
    { acceptAddress: "ISRAEL", acceptTime: "2026-09-15 12:36:58", remark: "Released from customs" },
    { acceptAddress: "", acceptTime: "2026-09-11 09:38:17", remark: "Departed from HongKong" },
  ],
}, NOW);

const ORDER = {
  name: "#4364",
  cancelledAt: null,
  displayFinancialStatus: "PAID",
  displayFulfillmentStatus: "FULFILLED",
  email: "customer@example.com",
  customer: { firstName: "אורית" },
  lineItems: { nodes: [{ name: "NovaHair Root Touch-Up", quantity: 1, variantTitle: "חום כהה" }] },
  fulfillments: [{ displayStatus: "IN_TRANSIT", deliveredAt: null, trackingInfo: [{ company: "CJPacket", number: "95054578", url: null }] }],
};

test("the canned order-status reply names the verified location, not 'on the way'", () => {
  const policy = evaluateSupportPolicy("היי, איפה ההזמנה שלי? עדיין לא הגיעה");
  assert.equal(policy.topic, "ORDER_STATUS");
  const decision = deterministicLowRiskDecision({ policy, orderContext: [{ ...ORDER, tracking: IN_ISRAEL }] });
  assert.ok(decision, "a verified order with tracking must produce a deterministic reply");
  assert.match(decision.replyText, /בישראל/);
  assert.match(decision.replyText, /CJPAQZ6280600013YQ/);
  assert.match(decision.replyText, /apps\/funnels\/track\?order=4364/);
  assert.doesNotMatch(decision.replyText, /נמצאת בתהליך המשלוח/);
  assert.ok(decision.factsUsed.some(fact => /Parcel prepared to be sent to pickup point/.test(fact)));
});

test("without carrier events the reply falls back to the honest generic line and the store's own page", () => {
  const policy = evaluateSupportPolicy("איפה ההזמנה שלי?");
  const decision = deterministicLowRiskDecision({ policy, orderContext: [{ ...ORDER, tracking: null }] });
  assert.ok(decision);
  assert.match(decision.replyText, /נמצאת בתהליך המשלוח/);
  assert.match(decision.replyText, /apps\/funnels\/track\?order=4364/);
  assert.doesNotMatch(decision.replyText, /17TRACK/);
});

test("a delivered parcel never gets an automatic 'where is it' reply", () => {
  const policy = evaluateSupportPolicy("איפה ההזמנה שלי?");
  const delivered = normalizeCjTracking({ trackingNumber: "x", routes: [{ acceptAddress: "ISRAEL", acceptTime: "2026-09-15 10:00:00", remark: "Delivered" }] }, NOW);
  assert.equal(deterministicLowRiskDecision({ policy, orderContext: [{ ...ORDER, tracking: delivered }] }), null);
});

test("outreach emails are personal, state the real event, and link the store's tracking page", () => {
  const arrived = arrivedIsraelText(ORDER, IN_ISRAEL);
  assert.match(arrived, /^היי אורית/);
  assert.match(arrived, /#4364 \(חום כהה\)/);
  assert.match(arrived, /בישראל/);
  assert.match(arrived, /apps\/funnels\/track\?order=4364/);

  const delay = delayText(ORDER, IN_ISRAEL, 15);
  assert.match(delay, /15 ימי עסקים/);
  assert.match(delay, /המצב האמיתי נכון לעכשיו/);
  assert.doesNotMatch(delay, /הנחה/);

  const gift = giftText(ORDER, null, 21, "NOVA-SORRY-4364-AB12");
  assert.match(gift, /NOVA-SORRY-4364-AB12/);
  assert.match(gift, /15% הנחה/);
  assert.match(gift, /החלפה או החזר/);
  // No code issued (Shopify refused): the apology still stands, without a broken promise.
  const noGift = giftText(ORDER, null, 21, null);
  assert.doesNotMatch(noGift, /הנחה/);
  assert.match(noGift, /מצטערים/);
});
