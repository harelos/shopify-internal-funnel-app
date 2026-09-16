import { normalizeCjTracking, type CjTrackingRaw, type ShipmentStatus } from "./cj-tracking.js";
import { supportD1 } from "./support-d1.js";
import { cjTrackInfo } from "../services/novahair-monitor.js";

/**
 * Fetches CJ tracking for one number, through a short D1 cache.
 *
 * The support AI, the storefront tracking page, the dashboard and the outreach
 * cron all ask the same question about the same parcels; without a cache that
 * is one CJ call per question and CJ rate-limits. Two hours is short enough
 * that a customs release shows up the same afternoon.
 */
const DEFAULT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export async function getShipmentStatus(trackingNumber: string, options: { maxAgeMs?: number } = {}): Promise<ShipmentStatus | null> {
  const number = String(trackingNumber || "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 60);
  if (!number) return null;
  const maxAge = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const db = supportD1();
  try {
    const cached = await db.prepare('SELECT "statusJson", "fetchedAt" FROM "ShipmentTrackingCache" WHERE "trackingNumber" = ? LIMIT 1')
      .bind(number).first<{ statusJson: string; fetchedAt: string }>();
    if (cached) {
      const age = Date.now() - new Date(cached.fetchedAt.replace(" ", "T") + (cached.fetchedAt.endsWith("Z") ? "" : "Z")).getTime();
      if (Number.isFinite(age) && age < maxAge) return JSON.parse(cached.statusJson) as ShipmentStatus;
    }
  } catch {
    // A cache miss or an unmigrated table must never block a live answer.
  }

  let raw: CjTrackingRaw | null = null;
  try {
    raw = await cjTrackInfo(number);
  } catch {
    raw = null;
  }
  if (!raw) {
    // Serve the stale copy rather than nothing while CJ is unavailable.
    try {
      const stale = await db.prepare('SELECT "statusJson" FROM "ShipmentTrackingCache" WHERE "trackingNumber" = ? LIMIT 1')
        .bind(number).first<{ statusJson: string }>();
      if (stale) return JSON.parse(stale.statusJson) as ShipmentStatus;
    } catch { /* fall through */ }
    return null;
  }
  const status = normalizeCjTracking(raw);
  try {
    await db.prepare(`INSERT INTO "ShipmentTrackingCache"
      ("trackingNumber", "cjMailNo", "stage", "delivered", "inIsrael", "exception", "latestRemark", "latestAt", "statusJson", "fetchedAt")
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT("trackingNumber") DO UPDATE SET
        "cjMailNo" = excluded."cjMailNo", "stage" = excluded."stage", "delivered" = excluded."delivered",
        "inIsrael" = excluded."inIsrael", "exception" = excluded."exception", "latestRemark" = excluded."latestRemark",
        "latestAt" = excluded."latestAt", "statusJson" = excluded."statusJson", "fetchedAt" = CURRENT_TIMESTAMP`)
      .bind(number, status.cjMailNo, status.stage, status.delivered ? 1 : 0, status.inIsrael ? 1 : 0, status.exception ? 1 : 0,
        status.latestRemark, status.latestAt, JSON.stringify(status)).run();
  } catch { /* cache write failures are not customer-visible */ }
  return status;
}
