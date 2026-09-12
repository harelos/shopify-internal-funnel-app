export type NormalizedShipmentState =
  | "PAID"
  | "SUPPLIER_PROCESSING"
  | "TRACKING_ASSIGNED"
  | "CARRIER_PICKED_UP"
  | "IN_TRANSIT"
  | "DELAYED"
  | "OUT_FOR_DELIVERY"
  | "READY_FOR_PICKUP"
  | "PICKED_UP"
  | "DELIVERED"
  | "BUYER_ACTION_REQUIRED"
  | "ATTEMPTED_DELIVERY"
  | "RETURNING_TO_SENDER"
  | "REFUNDED"
  | "DISPUTED"
  | "UNKNOWN";

export interface ShipmentRiskInput {
  state: NormalizedShipmentState;
  paidAt: string;
  trackingAssignedAt?: string | null;
  lastCarrierEventAt?: string | null;
  now: string;
}

export interface ShipmentRiskFinding {
  ruleId: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  customerMessageEligible: boolean;
}

function utcDate(value: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("invalid_shipment_timestamp");
  return date;
}

function israelBusinessDay(date: Date): boolean {
  const day = date.getUTCDay();
  return day !== 5 && day !== 6;
}

export function israelBusinessDaysBetween(startValue: string, endValue: string): number {
  const start = utcDate(startValue);
  const end = utcDate(endValue);
  if (end.getTime() <= start.getTime()) return 0;
  const cursor = new Date(Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate() + 1,
  ));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  let count = 0;
  while (cursor.getTime() <= last.getTime()) {
    if (israelBusinessDay(cursor)) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

export function addIsraelBusinessDays(value: string, days: number): string {
  const start = utcDate(value);
  const result = new Date(start);
  let remaining = Math.max(0, Math.trunc(days));
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    if (israelBusinessDay(result)) remaining -= 1;
  }
  return result.toISOString();
}

export function evaluateShipmentRisk(input: ShipmentRiskInput): ShipmentRiskFinding[] {
  const paidAge = israelBusinessDaysBetween(input.paidAt, input.now);
  const findings: ShipmentRiskFinding[] = [];
  const terminal = ["PICKED_UP", "DELIVERED", "REFUNDED"].includes(input.state);
  if (terminal) return findings;

  if (input.state === "DISPUTED") {
    return [{ ruleId: "dispute_open", severity: "CRITICAL", customerMessageEligible: false }];
  }
  if (["BUYER_ACTION_REQUIRED", "ATTEMPTED_DELIVERY", "RETURNING_TO_SENDER"].includes(input.state)) {
    findings.push({
      ruleId: input.state.toLowerCase(),
      severity: "CRITICAL",
      customerMessageEligible: true,
    });
  }
  if (input.state === "DELAYED") {
    findings.push({ ruleId: "carrier_delay", severity: "WARNING", customerMessageEligible: true });
  }

  if (!input.trackingAssignedAt) {
    if (paidAge >= 5) {
      findings.push({ ruleId: "tracking_missing_5bd", severity: "CRITICAL", customerMessageEligible: false });
    } else if (paidAge >= 2) {
      findings.push({ ruleId: "tracking_missing_2bd", severity: "WARNING", customerMessageEligible: false });
    }
  }

  if (input.lastCarrierEventAt && !["READY_FOR_PICKUP", "OUT_FOR_DELIVERY"].includes(input.state)) {
    const staleAge = israelBusinessDaysBetween(input.lastCarrierEventAt, input.now);
    if (staleAge >= 5) {
      findings.push({ ruleId: "carrier_no_movement_5bd", severity: "CRITICAL", customerMessageEligible: true });
    } else if (staleAge >= 3) {
      findings.push({ ruleId: "carrier_no_movement_3bd", severity: "WARNING", customerMessageEligible: true });
    }
  }

  if (paidAge >= 14) {
    findings.push({ ruleId: "delivery_promise_breach_14bd", severity: "CRITICAL", customerMessageEligible: true });
  } else if (paidAge >= 10 && !["READY_FOR_PICKUP", "OUT_FOR_DELIVERY"].includes(input.state)) {
    findings.push({ ruleId: "delivery_promise_risk_10bd", severity: "WARNING", customerMessageEligible: true });
  }
  return findings;
}
