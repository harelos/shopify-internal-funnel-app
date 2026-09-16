import { normalizeCjTracking, type CjTrackingRoute, type ShipmentStatus } from "./cj-tracking.js";

/**
 * Re-scores a monitor record from the carrier's own events.
 *
 * The Python monitor scores by the calendar: "not delivered after 14 business
 * days" was CRITICAL even for a parcel released from Israeli customs that
 * morning, and a label two days old was already HIGH. That painted most of the
 * board red and hid the handful of orders that actually need a person. The
 * monitor sends the raw CJ routes with every record, so the Worker can rescore
 * here, on ingest, without depending on a Railway deploy.
 */
export interface ShipmentSignal {
  code: string;
  severity: "MONITORING" | "MEDIUM" | "HIGH" | "CRITICAL";
  label: string;
  action: string;
  contact: string;
}

const WEIGHT: Record<ShipmentSignal["severity"], number> = { MONITORING: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

/** Signals the Python scorer derives from day counts alone; replaced below. */
const CALENDAR_SIGNALS = new Set([
  "DAY_14_SOLUTION_DUE", "DAY_14_MOVING", "DAY_10_CUSTOMER_UPDATE",
  "LABEL_NO_PICKUP_CRITICAL", "LABEL_NO_PICKUP_WARNING", "TRACKING_STALE",
]);

const STAGE_LABEL: Record<string, string> = {
  UNKNOWN: "Moving normally",
  LABEL_CREATED: "Label created, warehouse packing",
  CN_WAREHOUSE: "Left the CJ warehouse (China)",
  TO_HONG_KONG: "In Hong Kong, waiting for flight",
  IN_AIR: "Departed Hong Kong, flying to Israel",
  IL_AIRPORT: "Arrived at TLV airport",
  IL_CUSTOMS: "In Israeli customs",
  IL_CUSTOMS_RELEASED: "Released from customs",
  IL_LAST_MILE: "With the Israeli courier, heading to pickup point",
  IL_READY_FOR_PICKUP: "Waiting at the pickup point",
  DELIVERED: "Delivered",
  EXCEPTION: "Carrier exception",
};

export interface RescoreInput {
  severity: string;
  primarySignal: string | null;
  statusLabel: string | null;
  doNow: string | null;
  contactTarget: string | null;
  signals: ShipmentSignal[];
  delivered: boolean;
  trackingPresent?: boolean;
  trackingLast4?: string | null;
  trackingNumber?: string | null;
  trackingStatus?: string | null;
  cjMailNo?: string | null;
  trackingRoutes?: CjTrackingRoute[] | null;
  orderBusinessDays: number;
  labelBusinessDays: number;
  outWarehouseAt?: string | null;
}

export interface RescoreResult {
  severity: ShipmentSignal["severity"];
  primarySignal: string;
  statusLabel: string;
  doNow: string;
  contactTarget: string;
  signals: ShipmentSignal[];
  delivered: boolean;
  inactiveDays: number;
  trackingStage: string | null;
  latestRemark: string | null;
  latestTrackingAt: string | null;
  status: ShipmentStatus | null;
}

export function rescoreShipment(input: RescoreInput, now: Date = new Date(), precomputed: ShipmentStatus | null = null): RescoreResult {
  const routes = Array.isArray(input.trackingRoutes) ? input.trackingRoutes.filter(r => r && typeof r === "object") : [];
  const trackingPresent = Boolean(input.trackingPresent ?? (input.trackingNumber || input.trackingLast4));
  const status = precomputed ? precomputed : trackingPresent
    ? normalizeCjTracking({ trackingNumber: input.trackingNumber || input.trackingLast4 || "?", trackingStatus: input.trackingStatus || null, cjMailNo: input.cjMailNo || null, routes }, now)
    : null;
  const stage = status?.stage || null;
  const stageLabel = STAGE_LABEL[stage || "UNKNOWN"] || "Moving normally";
  const inIsrael = Boolean(status?.inIsrael);
  const lastMile = stage === "IL_LAST_MILE" || stage === "IL_READY_FOR_PICKUP";
  const delivered = Boolean(input.delivered) || Boolean(status?.delivered);
  const inactiveDays = status?.inactiveDays ?? 0;
  const hasScan = Boolean(status?.latestAt);
  const physicalMovement = Boolean(input.outWarehouseAt) || (hasScan && stage !== "LABEL_CREATED" && stage !== "UNKNOWN");
  const days = Math.max(0, Math.floor(Number(input.orderBusinessDays) || 0));
  const labelDays = Math.max(0, Math.floor(Number(input.labelBusinessDays) || 0));

  const signals: ShipmentSignal[] = (input.signals || []).filter(s => s && !CALENDAR_SIGNALS.has(String(s.code)));
  const push = (code: string, severity: ShipmentSignal["severity"], label: string, action: string, contact: string) =>
    signals.push({ code, severity, label, action, contact });

  if (!delivered && trackingPresent) {
    // CJ's warehouse takes 4-6 business days between the label and the first
    // physical scan on this lane; alerting at day 2 was noise.
    if (!physicalMovement) {
      if (labelDays >= 8) push("LABEL_NO_PICKUP_CRITICAL", "CRITICAL", `Label without pickup for ${labelDays} business days`, "Escalate to CJ now and request a physical pickup scan or a replacement plan.", "CJ");
      else if (labelDays >= 5) push("LABEL_NO_PICKUP_WARNING", "HIGH", `Label without pickup for ${labelDays} business days`, "Ask CJ to confirm when the parcel will physically leave the warehouse.", "CJ");
    }
    // A parcel waiting at an Israeli pickup point legitimately shows no scans
    // for days; silence before the last mile is a carrier problem.
    const staleThreshold = lastMile ? 6 : 3;
    if (physicalMovement && hasScan && inactiveDays >= staleThreshold) {
      push("TRACKING_STALE", "MEDIUM", `No tracking update for ${inactiveDays} days (${stageLabel})`, "Request a movement update and prepare a customer update if the carrier cannot confirm progress.", "CJ");
    }
  }

  // The day count alone is not the emergency; what needs a remedy is a parcel
  // that is both late and silent, or late beyond any normal transit.
  const moving = hasScan && inactiveDays < 4;
  if (!delivered && (days >= 22 || (days >= 14 && !moving && !inIsrael))) {
    push("DAY_14_SOLUTION_DUE", "CRITICAL",
      hasScan ? `Not delivered after ${days} business days, no movement for ${inactiveDays} days` : `Not delivered after ${days} business days`,
      "Choose a concrete remedy for the customer; do not send another waiting-only reply.", "Customer + CJ");
  } else if (!delivered && days >= 14) {
    push("DAY_14_MOVING", "MEDIUM", `Day ${days}: ${stageLabel}`, "Late but moving; the proactive delivery update goes out automatically. Watch for the next scan.", "Monitor");
  } else if (!delivered && days >= 10 && !moving && !inIsrael && trackingPresent) {
    push("DAY_10_CUSTOMER_UPDATE", "HIGH", `Business day ${days}, no movement for ${inactiveDays} days`, "Ask CJ for a movement update; the proactive customer update goes out automatically.", "Customer");
  }

  if (status?.exception && !signals.some(s => s.code === "CARRIER_EXCEPTION")) {
    push("CARRIER_EXCEPTION", "CRITICAL", "Carrier exception", "Escalate to CJ today and prepare a concrete customer solution for approval.", "CJ + Customer");
  }

  signals.sort((a, b) => (WEIGHT[b.severity] ?? 0) - (WEIGHT[a.severity] ?? 0));
  const primary: ShipmentSignal = signals[0] || {
    code: "MONITORING", severity: "MONITORING",
    label: delivered ? "Delivered" : trackingPresent ? stageLabel : "Within the normal preparation window",
    action: "No action needed. Keep monitoring the next verified milestone.", contact: "Monitor",
  };
  return {
    severity: primary.severity,
    primarySignal: primary.code,
    statusLabel: primary.label,
    doNow: primary.action,
    contactTarget: primary.contact,
    signals,
    delivered,
    inactiveDays,
    trackingStage: stage,
    latestRemark: status?.latestRemark || null,
    latestTrackingAt: status?.latestAt || null,
    status,
  };
}
