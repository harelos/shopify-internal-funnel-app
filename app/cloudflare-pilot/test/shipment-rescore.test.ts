import assert from "node:assert/strict";
import test from "node:test";
import { rescoreShipment } from "../src/lib/shipment-risk.js";

const NOW = new Date("2026-09-15T14:00:00Z");

// What the Python monitor sent for #4364 on 2026-09-15: CRITICAL by the calendar.
const RECORD_4364 = {
  severity: "CRITICAL",
  primarySignal: "DAY_14_SOLUTION_DUE",
  statusLabel: "Not delivered after 17 business days",
  doNow: "Choose a concrete remedy for the customer; do not send another waiting-only reply.",
  contactTarget: "Customer + CJ",
  signals: [{ code: "DAY_14_SOLUTION_DUE", severity: "CRITICAL" as const, label: "Not delivered after 17 business days", action: "x", contact: "Customer + CJ" }],
  delivered: false,
  trackingPresent: true,
  trackingLast4: "4578",
  trackingStatus: "En Route",
  orderBusinessDays: 17,
  labelBusinessDays: 11,
  trackingRoutes: [
    { acceptAddress: "ISRAEL", acceptTime: "2026-09-15 12:56:59", remark: "Parcel prepared to be sent to pickup point" },
    { acceptAddress: "ISRAEL", acceptTime: "2026-09-15 12:36:58", remark: "Released from customs" },
    { acceptAddress: "", acceptTime: "2026-09-11 18:01:30", remark: "Arrived at TLV Airport" },
    { acceptAddress: "", acceptTime: "2026-09-11 09:38:17", remark: "Departed from HongKong" },
    { acceptAddress: "", acceptTime: "2026-09-08 10:07:49", remark: "Arrived at E-post china warehouse" },
    { acceptAddress: "", acceptTime: "2026-08-31 06:36:44", remark: "Label created. Warehouse is processing this order." },
  ],
};

test("a parcel released from Israeli customs on day 17 is late-but-moving, not critical", () => {
  const out = rescoreShipment(RECORD_4364, NOW);
  assert.equal(out.severity, "MEDIUM");
  assert.equal(out.primarySignal, "DAY_14_MOVING");
  assert.equal(out.trackingStage, "IL_LAST_MILE");
  assert.equal(out.latestRemark, "Parcel prepared to be sent to pickup point");
  assert.match(out.statusLabel, /pickup point/);
  assert.ok(!out.signals.some(s => s.code === "DAY_14_SOLUTION_DUE"));
});

test("late and silent stays critical, and the label says how long the silence is", () => {
  const out = rescoreShipment({
    ...RECORD_4364,
    trackingRoutes: [
      { acceptAddress: "", acceptTime: "2026-09-05 09:38:17", remark: "Departed from HongKong" },
      { acceptAddress: "", acceptTime: "2026-09-01 10:07:49", remark: "Arrived at E-post china warehouse" },
    ],
  }, NOW);
  assert.equal(out.severity, "CRITICAL");
  assert.equal(out.primarySignal, "DAY_14_SOLUTION_DUE");
  assert.match(out.statusLabel, /no movement for 10 days/);
});

test("a two-day-old label is not an alert; an eight-day-old one is", () => {
  const label = (age: string, labelDays: number) => rescoreShipment({
    severity: "HIGH", primarySignal: "LABEL_NO_PICKUP_WARNING", statusLabel: "", doNow: "", contactTarget: "",
    signals: [{ code: "LABEL_NO_PICKUP_WARNING", severity: "HIGH", label: "", action: "", contact: "" }],
    delivered: false, trackingPresent: true, trackingLast4: "0001", trackingStatus: "Processing",
    orderBusinessDays: labelDays + 1, labelBusinessDays: labelDays,
    trackingRoutes: [{ acceptAddress: "", acceptTime: age, remark: "Label created. Warehouse is processing this order." }],
  }, NOW);
  assert.equal(label("2026-09-13 10:00:00", 2).severity, "MONITORING");
  assert.equal(label("2026-09-13 10:00:00", 2).statusLabel, "Label created, warehouse packing");
  assert.equal(label("2026-09-03 10:00:00", 8).severity, "CRITICAL");
});

test("signals the monitor derived from evidence, not the calendar, are kept", () => {
  const out = rescoreShipment({
    ...RECORD_4364,
    signals: [
      { code: "DAY_14_SOLUTION_DUE", severity: "CRITICAL", label: "", action: "", contact: "" },
      { code: "CJ_PAYMENT_REQUIRED", severity: "HIGH", label: "CJ payment or confirmation required", action: "Pay", contact: "CJ" },
    ],
  }, NOW);
  assert.deepEqual(out.signals.map(s => s.code), ["CJ_PAYMENT_REQUIRED", "DAY_14_MOVING"]);
  assert.equal(out.severity, "HIGH");
});

test("a delivered scan closes the order even when the monitor missed it", () => {
  const out = rescoreShipment({
    ...RECORD_4364,
    trackingRoutes: [{ acceptAddress: "ISRAEL", acceptTime: "2026-09-15 10:00:00", remark: "Delivered" }, ...RECORD_4364.trackingRoutes],
  }, NOW);
  assert.equal(out.delivered, true);
  assert.equal(out.severity, "MONITORING");
  assert.equal(out.statusLabel, "Delivered");
});
