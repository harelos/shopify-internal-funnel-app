import { Router } from "express";
import type { Request } from "express";
import { supportD1, supportId, supportNow } from "../lib/support-d1.js";
import { workerEnvValue } from "../lib/shopify-config.js";

type Row = Record<string, unknown>;
type ShipmentInput = Record<string, unknown>;

const WORKFLOW_STATES = new Set([
  "NEW",
  "ACKNOWLEDGED",
  "ASSIGNED",
  "WAITING_FOR_CJ",
  "CUSTOMER_UPDATED",
  "RESOLVED",
]);
const SEVERITIES = new Set(["CRITICAL", "HIGH", "MEDIUM", "MONITORING"]);

function text(value: unknown, max = 500): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, max) : null;
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function flag(value: unknown): number {
  return value === true || value === 1 || value === "1" ? 1 : 0;
}

function json(value: unknown, fallback: unknown): string {
  try {
    return JSON.stringify(value ?? fallback).slice(0, 20_000);
  } catch {
    return JSON.stringify(fallback);
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length || a.length === 0) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result |= a[index] ^ b[index];
  return result === 0;
}

function authorized(req: Request): boolean {
  const expected = workerEnvValue("SHIPMENT_BRIDGE_TOKEN");
  const supplied = String(req.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!expected || !supplied) return false;
  return constantTimeEqual(expected, supplied);
}

function normalizeShipment(input: ShipmentInput, now: string) {
  const orderName = text(input.orderName, 32);
  const numeric = Number(String(orderName || "").replace(/\D/g, ""));
  if (!orderName || !/^#\d+$/.test(orderName) || !numeric) return null;
  const severityRaw = String(input.severity || "MONITORING").toUpperCase();
  const severity = SEVERITIES.has(severityRaw) ? severityRaw : "MONITORING";
  const signals = Array.isArray(input.signals) ? input.signals.slice(0, 12) : [];
  return {
    id: `shipment_${numeric}`,
    orderName,
    shopifyOrderGid: text(input.shopifyOrderGid, 120),
    providerOrderReference: text(input.providerOrderReference, 120),
    severity,
    primarySignal: text(input.primarySignal, 80) || "MONITORING",
    statusLabel: text(input.statusLabel, 300) || "Monitoring",
    doNow: text(input.doNow, 800) || "Keep monitoring the next verified milestone.",
    contactTarget: text(input.contactTarget, 80) || "Monitor",
    signalsJson: json(signals, []),
    isActionable: flag(input.isActionable),
    delivered: flag(input.delivered),
    sourceAgreement: text(input.sourceAgreement, 40) || "VERIFIED",
    shopifyFinancialStatus: text(input.shopifyFinancialStatus, 50),
    shopifyFulfillmentStatus: text(input.shopifyFulfillmentStatus, 50),
    shopifyRiskRecommendation: text(input.shopifyRiskRecommendation, 50),
    saleTransactionCount: Math.max(0, Math.floor(number(input.saleTransactionCount))),
    afterSellLikely: flag(input.afterSellLikely),
    cjStatus: text(input.cjStatus, 80),
    cjSubStatus: text(input.cjSubStatus, 80),
    trackingStatus: text(input.trackingStatus, 160),
    trackingProvider: text(input.trackingProvider, 160),
    trackingLast4: text(input.trackingLast4, 8),
    orderBusinessDays: Math.max(0, Math.floor(number(input.orderBusinessDays))),
    labelBusinessDays: Math.max(0, Math.floor(number(input.labelBusinessDays))),
    inactiveDays: Math.max(0, Math.floor(number(input.inactiveDays))),
    orderCreatedAt: text(input.orderCreatedAt, 50),
    trackingCreatedAt: text(input.trackingCreatedAt, 50),
    latestTrackingAt: text(input.latestTrackingAt, 50),
    outWarehouseAt: text(input.outWarehouseAt, 50),
    now,
  };
}

export const shipmentBridgeRouter = Router();
export const shipmentAdminRouter = Router();

shipmentBridgeRouter.post("/ingest", async (req, res) => {
  if (!authorized(req)) {
    console.warn("[SHIPMENT BRIDGE REJECTED]", JSON.stringify({
      secretConfigured: Boolean(workerEnvValue("SHIPMENT_BRIDGE_TOKEN")),
      bearerPresent: /^Bearer\s+\S+/i.test(String(req.get("authorization") || "")),
    }));
    return res.status(401).json({ error: "Shipment bridge authorization failed." });
  }
  const body = req.body || {};
  if (number(body.schemaVersion) !== 1 || !Array.isArray(body.orders) || body.orders.length > 250) {
    return res.status(400).json({ error: "Invalid shipment snapshot." });
  }
  const runId = text(body.runId, 120);
  const generatedAt = text(body.generatedAt, 50);
  if (!runId || !generatedAt) return res.status(400).json({ error: "Snapshot identity is required." });

  const db = supportD1();
  const now = supportNow();
  const shipments = body.orders
    .map((item: ShipmentInput) => normalizeShipment(item, now))
    .filter(Boolean) as Array<NonNullable<ReturnType<typeof normalizeShipment>>>;
  const sourceHealth = body.sourceHealth || {};
  const criticalCount = shipments.filter(item => item.severity === "CRITICAL" && item.isActionable).length;
  const actionableCount = shipments.filter(item => item.isActionable).length;

  await db.prepare(`INSERT OR IGNORE INTO "ShipmentMonitorRun"
    ("id", "generatedAt", "receivedAt", "timeZone", "shopifyState", "cjState", "orderCount",
     "actionableCount", "criticalCount", "duplicateCjOrderCount", "cjReadErrorCount", "sourceHealthJson")
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      runId, generatedAt, now, text(body.timeZone, 80) || "Asia/Jerusalem",
      text(sourceHealth.shopify, 40) || "UNKNOWN", text(sourceHealth.cj, 40) || "UNKNOWN",
      shipments.length, actionableCount, criticalCount,
      Math.max(0, Math.floor(number(sourceHealth.duplicateCjOrderCount))),
      Math.max(0, Math.floor(number(sourceHealth.cjReadErrorCount))),
      json(sourceHealth, {}),
    ).run();

  await db.prepare(`UPDATE "ShipmentOrderState" SET "active" = 0, "updatedAt" = ?`).bind(now).run();
  for (const item of shipments) {
    await db.prepare(`INSERT INTO "ShipmentOrderState"
      ("id", "orderName", "shopifyOrderGid", "providerOrderReference", "severity", "primarySignal",
       "statusLabel", "doNow", "contactTarget", "signalsJson", "workflowState", "isActionable",
       "delivered", "active", "sourceAgreement", "shopifyFinancialStatus", "shopifyFulfillmentStatus",
       "shopifyRiskRecommendation", "saleTransactionCount", "afterSellLikely", "cjStatus", "cjSubStatus",
       "trackingStatus", "trackingProvider", "trackingLast4", "orderBusinessDays", "labelBusinessDays",
       "inactiveDays", "orderCreatedAt", "trackingCreatedAt", "latestTrackingAt", "outWarehouseAt",
       "firstSeenAt", "lastSeenAt", "updatedAt")
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW', ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT("orderName") DO UPDATE SET
       "shopifyOrderGid" = excluded."shopifyOrderGid",
       "providerOrderReference" = excluded."providerOrderReference",
       "severity" = excluded."severity",
       "primarySignal" = excluded."primarySignal",
       "statusLabel" = excluded."statusLabel",
       "doNow" = excluded."doNow",
       "contactTarget" = excluded."contactTarget",
       "signalsJson" = excluded."signalsJson",
       "workflowState" = CASE
         WHEN ("ShipmentOrderState"."active" = 0 OR "ShipmentOrderState"."primarySignal" != excluded."primarySignal")
           AND excluded."isActionable" = 1 THEN 'NEW'
         ELSE "ShipmentOrderState"."workflowState" END,
       "resolvedAt" = CASE
         WHEN ("ShipmentOrderState"."active" = 0 OR "ShipmentOrderState"."primarySignal" != excluded."primarySignal")
           AND excluded."isActionable" = 1 THEN NULL
         ELSE "ShipmentOrderState"."resolvedAt" END,
       "isActionable" = excluded."isActionable",
       "delivered" = excluded."delivered",
       "active" = 1,
       "sourceAgreement" = excluded."sourceAgreement",
       "shopifyFinancialStatus" = excluded."shopifyFinancialStatus",
       "shopifyFulfillmentStatus" = excluded."shopifyFulfillmentStatus",
       "shopifyRiskRecommendation" = excluded."shopifyRiskRecommendation",
       "saleTransactionCount" = excluded."saleTransactionCount",
       "afterSellLikely" = excluded."afterSellLikely",
       "cjStatus" = excluded."cjStatus",
       "cjSubStatus" = excluded."cjSubStatus",
       "trackingStatus" = excluded."trackingStatus",
       "trackingProvider" = excluded."trackingProvider",
       "trackingLast4" = excluded."trackingLast4",
       "orderBusinessDays" = excluded."orderBusinessDays",
       "labelBusinessDays" = excluded."labelBusinessDays",
       "inactiveDays" = excluded."inactiveDays",
       "orderCreatedAt" = excluded."orderCreatedAt",
       "trackingCreatedAt" = excluded."trackingCreatedAt",
       "latestTrackingAt" = excluded."latestTrackingAt",
       "outWarehouseAt" = excluded."outWarehouseAt",
       "lastSeenAt" = excluded."lastSeenAt",
       "updatedAt" = excluded."updatedAt"`)
      .bind(
        item.id, item.orderName, item.shopifyOrderGid, item.providerOrderReference, item.severity,
        item.primarySignal, item.statusLabel, item.doNow, item.contactTarget, item.signalsJson,
        item.isActionable, item.delivered, item.sourceAgreement, item.shopifyFinancialStatus,
        item.shopifyFulfillmentStatus, item.shopifyRiskRecommendation, item.saleTransactionCount,
        item.afterSellLikely, item.cjStatus, item.cjSubStatus, item.trackingStatus, item.trackingProvider,
        item.trackingLast4, item.orderBusinessDays, item.labelBusinessDays, item.inactiveDays,
        item.orderCreatedAt, item.trackingCreatedAt, item.latestTrackingAt, item.outWarehouseAt,
        now, now, now,
      ).run();
  }

  res.setHeader("Cache-Control", "no-store");
  return res.json({ ok: true, runId, orderCount: shipments.length, actionableCount, criticalCount });
});

shipmentAdminRouter.get("/shipments/dashboard", async (_req, res) => {
  const db = supportD1();
  const [latestRun, orders, workflowCounts] = await Promise.all([
    db.prepare(`SELECT * FROM "ShipmentMonitorRun" ORDER BY "receivedAt" DESC LIMIT 1`).first<Row>(),
    db.prepare(`SELECT * FROM "ShipmentOrderState" WHERE "active" = 1
      ORDER BY CASE "severity" WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
      CAST(REPLACE("orderName", '#', '') AS INTEGER) DESC LIMIT 250`).all<Row>(),
    db.prepare(`SELECT "workflowState", COUNT(*) AS "count" FROM "ShipmentOrderState"
      WHERE "active" = 1 AND "isActionable" = 1 GROUP BY "workflowState"`).all<Row>(),
  ]);
  const rows: Array<Row & {
    isActionable: boolean;
    delivered: boolean;
    afterSellLikely: boolean;
    signals: unknown[];
    workflowState: unknown;
    severity: unknown;
    contactTarget: unknown;
  }> = (orders.results || []).map(row => ({
    ...row,
    isActionable: number(row.isActionable) > 0,
    delivered: number(row.delivered) > 0,
    afterSellLikely: number(row.afterSellLikely) > 0,
    workflowState: row.workflowState,
    severity: row.severity,
    contactTarget: row.contactTarget,
    signals: (() => { try { return JSON.parse(String(row.signalsJson || "[]")); } catch { return []; } })(),
    signalsJson: undefined,
  }));
  const openRows = rows.filter(row => row.isActionable && row.workflowState !== "RESOLVED");
  const workflow = Object.fromEntries((workflowCounts.results || []).map(row => [String(row.workflowState), number(row.count)]));
  const latestReceived = text(latestRun?.receivedAt, 50);
  const stale = !latestReceived || Date.now() - new Date(latestReceived).getTime() > 8 * 60 * 60 * 1000;
  res.setHeader("Cache-Control", "no-store");
  return res.json({
    ok: true,
    generatedAt: supportNow(),
    timeZone: "Asia/Jerusalem",
    latestRun,
    sourceState: !latestRun ? "NOT_CONNECTED" : stale ? "STALE" : (latestRun.cjState === "CURRENT" && latestRun.shopifyState === "CURRENT" ? "CURRENT" : "PARTIAL"),
    summary: {
      actionNow: openRows.length,
      critical: openRows.filter(row => row.severity === "CRITICAL").length,
      high: openRows.filter(row => row.severity === "HIGH").length,
      medium: openRows.filter(row => row.severity === "MEDIUM").length,
      contactCj: openRows.filter(row => String(row.contactTarget).includes("CJ")).length,
      updateCustomer: openRows.filter(row => String(row.contactTarget).includes("Customer")).length,
      monitoring: rows.filter(row => !row.isActionable).length,
      multiplePayments: rows.filter(row => row.afterSellLikely).length,
      workflow,
    },
    orders: rows,
  });
});

shipmentAdminRouter.patch("/shipments/:id/workflow", async (req, res) => {
  const id = text(req.params.id, 80);
  const requested = String(req.body?.state || "").trim().toUpperCase();
  const note = text(req.body?.note, 1_000);
  if (!id || !WORKFLOW_STATES.has(requested)) {
    return res.status(400).json({ error: "Choose a valid shipment workflow state." });
  }
  const db = supportD1();
  const existing = await db.prepare(`SELECT "id", "workflowState" FROM "ShipmentOrderState" WHERE "id" = ? LIMIT 1`)
    .bind(id).first<Row>();
  if (!existing) return res.status(404).json({ error: "Shipment order was not found." });
  const now = supportNow();
  await db.prepare(`UPDATE "ShipmentOrderState" SET
    "workflowState" = ?,
    "assignedTo" = CASE WHEN ? = 'ASSIGNED' THEN 'OWNER' ELSE "assignedTo" END,
    "ownerNote" = COALESCE(?, "ownerNote"),
    "resolvedAt" = CASE WHEN ? = 'RESOLVED' THEN ? ELSE NULL END,
    "updatedAt" = ?
    WHERE "id" = ?`)
    .bind(requested, requested, note, requested, now, now, id).run();
  await db.prepare(`INSERT INTO "ShipmentActionLog"
    ("id", "shipmentOrderId", "action", "previousState", "nextState", "note", "actor", "createdAt")
    VALUES (?, ?, 'WORKFLOW_CHANGED', ?, ?, ?, 'OWNER', ?)`)
    .bind(supportId("shipment_action"), id, existing.workflowState, requested, note, now).run();
  res.setHeader("Cache-Control", "no-store");
  return res.json({ ok: true, id, state: requested, updatedAt: now });
});
