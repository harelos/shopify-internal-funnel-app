import { supportD1 } from "../lib/support-d1.js";
import { getShipmentStatus } from "../lib/cj-tracking-store.js";
import { rescoreShipment, type ShipmentSignal } from "../lib/shipment-risk.js";
import { listCjOrders } from "./novahair-monitor.js";

/**
 * Keeps the shipment board truthful between the monitor's three daily
 * snapshots: resolves each active order's CJ tracking number, refreshes the
 * carrier events through the shared cache, and rescores the row from them.
 *
 * The monitor snapshot carries only the last four digits of the tracking
 * number, and the Railway deploy that would publish the full one is blocked;
 * CJ's order list carries it, so the Worker fills it in itself.
 */
const RESOLVE_PAGES = 3;
const REFRESH_PER_RUN = 15;
const MAX_AGE_MS = 2 * 60 * 60 * 1000;

interface ActiveRow {
  id: string;
  orderName: string;
  trackingNumber: string | null;
  trackingLast4: string | null;
  trackingStatus: string | null;
  cjStatus: string | null;
  signalsJson: string | null;
  orderBusinessDays: number;
  labelBusinessDays: number;
  outWarehouseAt: string | null;
  delivered: number;
  fetchedAt: string | null;
}

export async function refreshShipmentTracking(now: Date = new Date()): Promise<{ resolved: number; refreshed: number; skipped: number }> {
  const db = supportD1();
  const rows = (await db.prepare(`SELECT s."id", s."orderName", s."trackingNumber", s."trackingLast4", s."trackingStatus", s."cjStatus", s."signalsJson",
      s."orderBusinessDays", s."labelBusinessDays", s."outWarehouseAt", s."delivered", c."fetchedAt"
    FROM "ShipmentOrderState" s LEFT JOIN "ShipmentTrackingCache" c ON c."trackingNumber" = s."trackingNumber"
    WHERE s."active" = 1 AND s."delivered" = 0 ORDER BY s."orderBusinessDays" DESC LIMIT 150`).all<ActiveRow>()).results || [];

  let resolved = 0;
  const unresolved = rows.filter(row => !row.trackingNumber && (row.trackingLast4 || /SHIPPED|DELIVERED/i.test(String(row.cjStatus || ""))));
  if (unresolved.length) {
    const byOrder = new Map<string, string>();
    for (let page = 1; page <= RESOLVE_PAGES; page += 1) {
      let list: any[] = [];
      try { list = await listCjOrders(page, 100); } catch { break; }
      for (const row of list) {
        const match = /^(?:RESCUE|MANUAL)-(\d+)$/i.exec(String(row?.orderNum || "").trim());
        const number = String(row?.trackNumber || "").trim();
        if (!match || !number || /TRASH/i.test(String(row?.orderStatus || ""))) continue;
        if (!byOrder.has(`#${match[1]}`)) byOrder.set(`#${match[1]}`, number);
      }
      if (list.length < 100) break;
    }
    for (const row of unresolved) {
      const number = byOrder.get(row.orderName);
      if (!number || (row.trackingLast4 && !number.endsWith(row.trackingLast4))) continue;
      await db.prepare('UPDATE "ShipmentOrderState" SET "trackingNumber" = ? WHERE "id" = ?').bind(number, row.id).run();
      row.trackingNumber = number;
      resolved += 1;
    }
  }

  const due = rows
    .filter(row => row.trackingNumber)
    .filter(row => !row.fetchedAt || now.getTime() - new Date(row.fetchedAt.replace(" ", "T") + (row.fetchedAt.endsWith("Z") ? "" : "Z")).getTime() >= MAX_AGE_MS)
    .slice(0, REFRESH_PER_RUN);
  let refreshed = 0;
  for (const row of due) {
    const status = await getShipmentStatus(row.trackingNumber as string, { maxAgeMs: MAX_AGE_MS });
    if (!status) continue;
    let signals: ShipmentSignal[] = [];
    try { signals = JSON.parse(row.signalsJson || "[]"); } catch { signals = []; }
    const out = rescoreShipment({
      severity: "MONITORING", primarySignal: null, statusLabel: null, doNow: null, contactTarget: null,
      signals, delivered: row.delivered === 1, trackingPresent: true,
      trackingNumber: row.trackingNumber, trackingLast4: row.trackingLast4, trackingStatus: row.trackingStatus,
      orderBusinessDays: row.orderBusinessDays, labelBusinessDays: row.labelBusinessDays, outWarehouseAt: row.outWarehouseAt,
    }, now, status);
    await db.prepare(`UPDATE "ShipmentOrderState" SET "severity" = ?, "primarySignal" = ?, "statusLabel" = ?, "doNow" = ?, "contactTarget" = ?,
        "signalsJson" = ?, "isActionable" = ?, "delivered" = ?, "inactiveDays" = ?, "latestTrackingAt" = COALESCE(?, "latestTrackingAt"),
        "trackingStage" = ?, "latestRemark" = ?, "updatedAt" = ? WHERE "id" = ?`)
      .bind(out.severity, out.primarySignal, out.statusLabel.slice(0, 300), out.doNow.slice(0, 800), out.contactTarget,
        JSON.stringify(out.signals.slice(0, 12)), out.signals.length ? 1 : 0, out.delivered ? 1 : 0, out.inactiveDays, out.latestTrackingAt,
        out.trackingStage, out.latestRemark ? out.latestRemark.slice(0, 200) : null, now.toISOString(), row.id).run();
    refreshed += 1;
  }
  return { resolved, refreshed, skipped: rows.length - due.length };
}
