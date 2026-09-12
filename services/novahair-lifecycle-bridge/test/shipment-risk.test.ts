import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addIsraelBusinessDays,
  evaluateShipmentRisk,
  israelBusinessDaysBetween,
} from "../src/shipment-risk";
import { cjState } from "../src/shipment-assurance";
import { testDatabase } from "./helpers/d1";

test("Israel business-day helpers skip Friday and Saturday", () => {
  assert.equal(
    addIsraelBusinessDays("2026-09-10T10:00:00.000Z", 1),
    "2026-09-13T10:00:00.000Z",
  );
  assert.equal(
    israelBusinessDaysBetween("2026-09-10T10:00:00.000Z", "2026-09-13T10:00:00.000Z"),
    1,
  );
});

test("missing tracking warns at two business days and becomes critical at five", () => {
  const warning = evaluateShipmentRisk({
    state: "SUPPLIER_PROCESSING",
    paidAt: "2026-09-06T10:00:00.000Z",
    now: "2026-09-08T10:00:00.000Z",
  });
  assert.deepEqual(warning.map(item => item.ruleId), ["tracking_missing_2bd"]);

  const critical = evaluateShipmentRisk({
    state: "SUPPLIER_PROCESSING",
    paidAt: "2026-09-06T10:00:00.000Z",
    now: "2026-09-13T10:00:00.000Z",
  });
  assert.ok(critical.some(item => item.ruleId === "tracking_missing_5bd" && item.severity === "CRITICAL"));
});

test("stalled tracking and delivery-promise risk are independently explainable", () => {
  const findings = evaluateShipmentRisk({
    state: "IN_TRANSIT",
    paidAt: "2026-08-30T10:00:00.000Z",
    trackingAssignedAt: "2026-09-01T10:00:00.000Z",
    lastCarrierEventAt: "2026-09-06T10:00:00.000Z",
    now: "2026-09-13T10:00:00.000Z",
  });
  assert.ok(findings.some(item => item.ruleId === "carrier_no_movement_5bd"));
  assert.ok(findings.some(item => item.ruleId === "delivery_promise_risk_10bd"));
  assert.ok(findings.every(item => item.customerMessageEligible));
});

test("delivery and refund are terminal, while a dispute is internal-only", () => {
  assert.deepEqual(evaluateShipmentRisk({
    state: "DELIVERED",
    paidAt: "2026-08-01T00:00:00.000Z",
    now: "2026-09-12T00:00:00.000Z",
  }), []);
  assert.deepEqual(evaluateShipmentRisk({
    state: "DISPUTED",
    paidAt: "2026-09-10T00:00:00.000Z",
    now: "2026-09-12T00:00:00.000Z",
  }), [{ ruleId: "dispute_open", severity: "CRITICAL", customerMessageEligible: false }]);
});

test("CJPacket statuses normalize without treating a missing scan as delivery", () => {
  assert.equal(cjState({ statusDescription: "En Route" }), "IN_TRANSIT");
  assert.equal(cjState({ statusDescription: "Processing" }), "TRACKING_ASSIGNED");
  assert.equal(cjState({ statusDescription: "Delivered" }), "DELIVERED");
  assert.equal(cjState({ statusDescription: "Not found" }), "TRACKING_ASSIGNED");
  assert.equal(cjState({ statusDescription: "En Route", trackEvent: [{ activity: "Ready for pickup" }] }), "READY_FOR_PICKUP");
});

test("shipment assurance tables enforce idempotent tracking and notification claims", async () => {
  const { db, dispose } = await testDatabase();
  try {
    const now = "2026-09-12T12:00:00.000Z";
    await db.prepare(
      `INSERT INTO lifecycle_orders (
        shopify_order_id, consent_state, completed_at, quantity, payload_hash, created_at, updated_at
      ) VALUES (?, 'SUBSCRIBED', ?, 1, 'hash', ?, ?)`,
    ).bind("gid://shopify/Order/assurance-1", now, now, now).run();
    await db.prepare(
      `INSERT INTO lifecycle_tracking_events (
        event_key, shopify_order_id, source, normalized_state, happened_at,
        received_at, payload_hash
      ) VALUES (?, ?, 'CJPACKET', 'IN_TRANSIT', ?, ?, 'event-hash')`,
    ).bind("cj:event:1", "gid://shopify/Order/assurance-1", now, now).run();
    await assert.rejects(() => db.prepare(
      `INSERT INTO lifecycle_tracking_events (
        event_key, shopify_order_id, source, normalized_state, happened_at,
        received_at, payload_hash
      ) VALUES (?, ?, 'CJPACKET', 'IN_TRANSIT', ?, ?, 'event-hash')`,
    ).bind("cj:event:1", "gid://shopify/Order/assurance-1", now, now).run());

    await db.prepare(
      `INSERT INTO lifecycle_notification_claims (
        claim_key, shopify_order_id, purpose, state_version, owner, status,
        claimed_at, updated_at
      ) VALUES (?, ?, 'ready_for_pickup', 2, 'RESEND', 'CLAIMED', ?, ?)`,
    ).bind("order:assurance-1:ready_for_pickup:2", "gid://shopify/Order/assurance-1", now, now).run();
    const row = await db.prepare(
      "SELECT COUNT(*) AS count FROM lifecycle_notification_claims WHERE shopify_order_id = ?",
    ).bind("gid://shopify/Order/assurance-1").first<{ count: number }>();
    assert.equal(Number(row?.count), 1);
  } finally {
    await dispose();
  }
});
