import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeCjTracking, describeForCustomer, translateRemark } from "../src/lib/cj-tracking.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Verbatim CJ events for order #4364 on 2026-09-15. The monitor called this
// parcel CRITICAL and the support AI said it was "on the way".
const ROUTES_4364 = [
  { acceptAddress: "ISRAEL", acceptTime: "2026-09-15 12:56:59", remark: "Parcel prepared to be sent to pickup point" },
  { acceptAddress: "ISRAEL", acceptTime: "2026-09-15 12:36:58", remark: "Released from customs" },
  { acceptAddress: "ISRAEL", acceptTime: "2026-09-15 12:36:53", remark: "Arrived at customs" },
  { acceptAddress: "ISRAEL", acceptTime: "2026-09-12 06:13:48", remark: "The Parcel arrived at Israel customs" },
  { acceptAddress: "", acceptTime: "2026-09-11 18:01:30", remark: "Arrived at TLV Airport" },
  { acceptAddress: "", acceptTime: "2026-09-11 09:38:17", remark: "Departed from HongKong" },
  { acceptAddress: "", acceptTime: "2026-09-09 16:09:12", remark: "Waiting for flight" },
  { acceptAddress: "", acceptTime: "2026-09-09 13:08:45", remark: "Arrived in Hongkong" },
  { acceptAddress: "", acceptTime: "2026-09-08 20:08:20", remark: "Send to Hongkong" },
  { acceptAddress: "", acceptTime: "2026-09-08 10:07:49", remark: "Arrived at E-post china warehouse" },
  { acceptAddress: "", acceptTime: "2026-08-31 06:36:44", remark: "Label created. Warehouse is processing this order. Please wait in patience." },
];

test("a parcel released from Israeli customs is reported in Israel, on its last mile", () => {
  const status = normalizeCjTracking({ trackingNumber: "95054578", trackingStatus: "En Route", cjMailNo: "CJPAQZ6280600013YQ", routes: ROUTES_4364 }, new Date("2026-09-15T14:00:00Z"));
  assert.equal(status.stage, "IL_LAST_MILE");
  assert.equal(status.inIsrael, true);
  assert.equal(status.delivered, false);
  assert.equal(status.exception, false);
  assert.equal(status.inactiveDays, 0);
  assert.match(status.statusHe, /בישראל/);
  assert.match(status.nextStepHe, /SMS/);
  // The customer-facing number is the CJ Packet one, which is what the carrier site knows.
  assert.equal(status.cjMailNo, "CJPAQZ6280600013YQ");
  assert.match(status.trackUrl, /CJPAQZ6280600013YQ/);
  const sentence = describeForCustomer(status);
  assert.match(sentence, /בישראל/);
  assert.doesNotMatch(sentence, /on the way|בדרך אלייך\.$/);
});

test("the most advanced event wins even when an older scan repeats an earlier stage", () => {
  // "Arrived at customs" is logged again after "Released from customs"; the parcel is still released.
  const status = normalizeCjTracking({ trackingNumber: "x", routes: ROUTES_4364.slice(1) });
  assert.equal(status.stage, "IL_CUSTOMS_RELEASED");
});

test("each leg of the China → Israel route maps to a stage in order", () => {
  const legs: Array<[string, string]> = [
    ["Label created. Warehouse is processing this order.", "LABEL_CREATED"],
    ["Arrived at E-post china warehouse", "CN_WAREHOUSE"],
    ["Arrived in Hongkong", "TO_HONG_KONG"],
    ["Departed from HongKong", "IN_AIR"],
    ["Arrived at TLV Airport", "IL_AIRPORT"],
    ["The Parcel arrived at Israel customs", "IL_CUSTOMS"],
    ["Released from customs", "IL_CUSTOMS_RELEASED"],
    ["Parcel prepared to be sent to pickup point", "IL_LAST_MILE"],
    ["Delivered", "DELIVERED"],
  ];
  let previous = -1;
  for (const [remark, stage] of legs) {
    const status = normalizeCjTracking({ trackingNumber: "x", routes: [{ acceptTime: "2026-09-10 10:00:00", acceptAddress: "", remark }] });
    assert.equal(status.stage, stage, remark);
    assert.ok(status.progress > previous, `${stage} must advance past the previous leg`);
    previous = status.progress;
  }
});

test("a carrier exception is never presented as normal transit", () => {
  const status = normalizeCjTracking({ trackingNumber: "x", trackingStatus: "En Route", routes: [
    { acceptTime: "2026-09-14 10:00:00", acceptAddress: "ISRAEL", remark: "Delivery failed - address incorrect" },
    ...ROUTES_4364.slice(3),
  ] });
  assert.equal(status.stage, "EXCEPTION");
  assert.equal(status.exception, true);
});

test("a number with no scans yet is 'being packed', not unknown", () => {
  const status = normalizeCjTracking({ trackingNumber: "95787686", trackingStatus: null, routes: [] });
  assert.equal(status.stage, "LABEL_CREATED");
  assert.equal(status.inactiveDays, null);
});

test("Hebrew translations exist for every real CJ remark seen on this lane", () => {
  for (const route of ROUTES_4364) {
    const he = translateRemark(route.remark);
    assert.notEqual(he, route.remark, `no Hebrew for: ${route.remark}`);
    assert.match(he, /[֐-׿]/);
  }
});

test("the support reply states the verified location instead of a generic transit line", () => {
  const replies = readFileSync(path.join(root, "src/lib/support-replies.ts"), "utf8");
  assert.match(replies, /describeForCustomer\(tracking\)/);
  assert.match(replies, /apps\/funnels\/track\?order=/);
  // The old generic sentence must only remain as the fallback when no events exist.
  const generic = replies.indexOf("היא כבר קיבלה מספר מעקב ונמצאת בתהליך המשלוח");
  const verified = replies.indexOf("describeForCustomer(tracking)");
  assert.ok(verified >= 0 && generic > verified, "verified tracking must be tried before the generic line");
  const ai = readFileSync(path.join(root, "src/lib/support-ai.ts"), "utf8");
  assert.match(ai, /never describe the parcel generically as 'on the way'/);
  const desk = readFileSync(path.join(root, "src/services/support-desk.ts"), "utf8");
  assert.match(desk, /order\.tracking = await getShipmentStatus\(number\)/);
});

test("outreach is idempotent, escalates what needs a human, and stays inside the Israeli day", () => {
  const src = readFileSync(path.join(root, "src/services/shipment-outreach.ts"), "utf8") + readFileSync(path.join(root, "src/lib/shipment-outreach-text.ts"), "utf8");
  assert.match(src, /SHIPMENT_OUTREACH_ENABLED/);
  assert.match(src, /if \(hour < 9 \|\| hour >= 20\)/);
  assert.match(src, /alreadySent\(db, candidate\.orderName, milestone\)/);
  assert.match(src, /customerHasOpenThread/);
  // Never-shipped and carrier exceptions go to a person, not to an automated email.
  assert.match(src, /\["CLOSED", "CANCELLED", "TRASH"\]\.includes\(cjStatus\)/);
  assert.match(src, /escalateForHuman\(db, shop\.id, order, "חריגה אצל חברת המשלוחים"/);
  // The gift is issued once, single-use, and only on a real delay.
  assert.match(src, /orderBusinessDays >= 20/);
  assert.match(src, /usageLimit: 1/.test(readFileSync(path.join(root, "src/lib/shopify-admin.ts"), "utf8")) ? /createSingleUseDiscount/ : /never/);
  const migration = readFileSync(path.join(root, "migrations/0022_shipment_tracking.sql"), "utf8");
  assert.match(migration, /UNIQUE INDEX IF NOT EXISTS "ShipmentOutreach_order_milestone"/);
});
