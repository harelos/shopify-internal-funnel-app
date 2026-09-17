/**
 * Turns CJ's raw tracking events into something a customer, an agent, and a
 * risk model can all use.
 *
 * CJ's tracking feed already says exactly where a parcel is ("Arrived at TLV
 * Airport", "Released from customs", "Parcel prepared to be sent to pickup
 * point"). The store only ever surfaced the coarse status "En Route", so the
 * dashboard flagged parcels that had already cleared Israeli customs as
 * critical, and the support AI told a customer whose parcel was at the pickup
 * point that it was "on the way". This module is the single place that reads
 * the events, so every surface tells the same story.
 */

export type ShipmentStage =
  | "LABEL_CREATED"
  | "CN_WAREHOUSE"
  | "TO_HONG_KONG"
  | "IN_AIR"
  | "IL_AIRPORT"
  | "IL_CUSTOMS"
  | "IL_CUSTOMS_RELEASED"
  | "IL_LAST_MILE"
  | "IL_READY_FOR_PICKUP"
  | "DELIVERED"
  | "EXCEPTION"
  | "UNKNOWN";

export interface CjTrackingRoute {
  acceptTime: string | null;
  acceptAddress: string | null;
  remark: string;
}

export interface CjTrackingRaw {
  trackingNumber: string;
  trackingStatus: string | null;
  cjMailNo: string | null;
  logisticName: string | null;
  deliveryDay: number | null;
  lastMileCarrier: string | null;
  routes: CjTrackingRoute[];
}

export interface ShipmentStatus {
  trackingNumber: string;
  cjMailNo: string | null;
  stage: ShipmentStage;
  /** Stage ordered 0..9 so callers can compare progress without string maps. */
  progress: number;
  delivered: boolean;
  inIsrael: boolean;
  exception: boolean;
  latestRemark: string | null;
  latestRemarkHe: string | null;
  latestAt: string | null;
  /** Days since the latest event, or null with no events. */
  inactiveDays: number | null;
  statusHe: string;
  nextStepHe: string;
  timelineHe: Array<{ at: string | null; text: string }>;
  trackUrl: string;
}

const STAGE_ORDER: ShipmentStage[] = [
  "UNKNOWN", "LABEL_CREATED", "CN_WAREHOUSE", "TO_HONG_KONG", "IN_AIR",
  "IL_AIRPORT", "IL_CUSTOMS", "IL_CUSTOMS_RELEASED", "IL_LAST_MILE", "IL_READY_FOR_PICKUP", "DELIVERED",
];

const EXCEPTION_TERMS = [
  "exception", "failed delivery", "delivery failed", "undeliverable", "return to sender",
  "returned to sender", "shipment returned", "delivery failure", "refused", "address incorrect",
  "customs hold", "held by customs", "lost",
];

// Ordered from most to least advanced so the first match wins.
const STAGE_RULES: Array<{ stage: ShipmentStage; test: RegExp; he: string }> = [
  { stage: "DELIVERED", test: /delivered|נמסר|signed for|collected by (?:the )?recipient/i, he: "החבילה נמסרה" },
  { stage: "IL_READY_FOR_PICKUP", test: /ready for (?:pick ?up|collection)|available for pickup|arrived at (?:the )?pickup point|awaiting collection/i, he: "החבילה מחכה לך בנקודת האיסוף" },
  { stage: "IL_LAST_MILE", test: /out for delivery|prepared to be sent to pickup point|sent to pickup point|handed to (?:local )?courier|local delivery|in delivery|israel post|doar/i, he: "החבילה בישראל, בדרך לנקודת האיסוף" },
  { stage: "IL_CUSTOMS_RELEASED", test: /released from customs|customs (?:clearance )?released|cleared customs/i, he: "החבילה שוחררה מהמכס בישראל" },
  { stage: "IL_CUSTOMS", test: /israel customs|arrived at customs|customs/i, he: "החבילה הגיעה למכס בישראל" },
  { stage: "IL_AIRPORT", test: /tlv|ben gurion|arrived (?:in|at) israel|arrived at destination/i, he: "החבילה נחתה בישראל" },
  { stage: "IN_AIR", test: /departed from hong ?kong|departed|in flight|airline|flight departed/i, he: "החבילה בטיסה לישראל" },
  { stage: "TO_HONG_KONG", test: /hong ?kong|waiting for flight|export|handover to airline/i, he: "החבילה במרכז המיון בהונג קונג לפני הטיסה" },
  { stage: "CN_WAREHOUSE", test: /e-post|china warehouse|left the warehouse|picked up|in transit|shipped out|departed from warehouse|arrived at sorting/i, he: "החבילה יצאה מהמחסן ובדרך למרכז המיון" },
  { stage: "LABEL_CREATED", test: /label created|warehouse is processing|shipment information received|pre-shipment|order (?:has been )?created/i, he: "ההזמנה נארזת במחסן, טרם יצאה" },
];

const REMARK_HE: Array<[RegExp, string]> = [
  [/^label created/i, "נוצרה תווית משלוח, המחסן מכין את ההזמנה"],
  [/e-post china warehouse/i, "הגיעה למרכז השילוח בסין"],
  [/send to hong ?kong/i, "נשלחה להונג קונג"],
  [/arrived in hong ?kong/i, "הגיעה להונג קונג"],
  [/waiting for flight/i, "ממתינה לטיסה"],
  [/departed from hong ?kong/i, "המריאה מהונג קונג"],
  [/arrived at tlv airport/i, "נחתה בנמל התעופה בן גוריון"],
  [/the parcel arrived at israel customs|arrived at customs/i, "הגיעה למכס בישראל"],
  [/released from customs/i, "שוחררה מהמכס"],
  [/prepared to be sent to pickup point/i, "בדרך לנקודת האיסוף"],
  [/arrived at (?:the )?pickup point|ready for pick ?up/i, "הגיעה לנקודת האיסוף"],
  [/out for delivery/i, "יצאה לחלוקה"],
  [/delivered/i, "נמסרה"],
];

const NEXT_STEP_HE: Record<ShipmentStage, string> = {
  UNKNOWN: "ברגע שתהיה סריקה חדשה של חברת המשלוחים היא תופיע כאן.",
  LABEL_CREATED: "בימים הקרובים החבילה תיסרק ביציאה מהמחסן ותקבל מספר מעקב פעיל.",
  CN_WAREHOUSE: "השלב הבא הוא הגעה למרכז המיון בהונג קונג לפני הטיסה לישראל.",
  TO_HONG_KONG: "השלב הבא הוא טיסה לישראל; בדרך כלל תוך 2–4 ימים.",
  IN_AIR: "השלב הבא הוא נחיתה בבן גוריון ומעבר במכס.",
  IL_AIRPORT: "השלב הבא הוא בדיקת מכס, בדרך כלל 1–3 ימי עסקים.",
  IL_CUSTOMS: "המכס משחרר חבילות בדרך כלל תוך 1–3 ימי עסקים, ואז היא עוברת לחלוקה.",
  IL_CUSTOMS_RELEASED: "החבילה עוברת עכשיו לחברת החלוקה בישראל; הודעת SMS עם נקודת האיסוף מגיעה בדרך כלל תוך 1–3 ימי עסקים.",
  IL_LAST_MILE: "תקבלי SMS מנקודת האיסוף ברגע שהחבילה מוכנה, בדרך כלל תוך 1–3 ימי עסקים.",
  IL_READY_FOR_PICKUP: "אפשר לאסוף אותה עם ההודעה שקיבלת; החבילה נשמרת בנקודה כשבוע.",
  DELIVERED: "אם עדיין לא קיבלת אותה בפועל, כתבי לנו ונבדוק מיד.",
  EXCEPTION: "אנחנו מטפלים בזה מול חברת המשלוחים ונעדכן אותך.",
};

export function translateRemark(remark: string): string {
  for (const [pattern, he] of REMARK_HE) if (pattern.test(remark)) return he;
  return remark;
}

function stageOf(remark: string): { stage: ShipmentStage; he: string } | null {
  for (const rule of STAGE_RULES) if (rule.test.test(remark)) return { stage: rule.stage, he: rule.he };
  return null;
}

function parseCjTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  // CJ timestamps are "YYYY-MM-DD HH:mm:ss" in China time (UTC+8).
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value);
  if (!match) {
    const fallback = new Date(value);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }
  const [, y, mo, d, h, mi, s] = match.map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h - 8, mi, s));
}

function formatIsraelDate(date: Date | null): string {
  if (!date) return "";
  return new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric" }).format(date);
}

export function normalizeCjTracking(raw: Partial<CjTrackingRaw> & { trackingNumber: string }, now: Date = new Date()): ShipmentStatus {
  const routes = [...(raw.routes || [])]
    .filter(route => route && typeof route.remark === "string" && route.remark.trim())
    .sort((a, b) => (parseCjTime(b.acceptTime)?.getTime() ?? 0) - (parseCjTime(a.acceptTime)?.getTime() ?? 0));
  const latest = routes[0] || null;
  const latestAtDate = latest ? parseCjTime(latest.acceptTime) : null;
  const evidence = [raw.trackingStatus || "", ...routes.map(route => route.remark)].join(" ").toLowerCase();
  const exception = EXCEPTION_TERMS.some(term => evidence.includes(term));

  // The most advanced stage seen wins: a "released from customs" event after
  // "arrived at customs" means released, even if a later scan repeats "arrived".
  let stage: ShipmentStage = "UNKNOWN";
  let statusHe = "";
  const statusUpper = String(raw.trackingStatus || "").toUpperCase();
  if (statusUpper === "DELIVERED") { stage = "DELIVERED"; statusHe = "החבילה נמסרה"; }
  for (const route of routes) {
    const hit = stageOf(route.remark);
    if (!hit) continue;
    if (STAGE_ORDER.indexOf(hit.stage) > STAGE_ORDER.indexOf(stage)) { stage = hit.stage; statusHe = hit.he; }
  }
  if (stage === "UNKNOWN" && routes.length === 0 && raw.trackingNumber) {
    stage = "LABEL_CREATED";
    statusHe = "ההזמנה נארזת במחסן, טרם יצאה";
  }
  if (exception && stage !== "DELIVERED") { stage = "EXCEPTION"; statusHe = "יש עיכוב חריג בחבילה ואנחנו מטפלים בו"; }

  const delivered = stage === "DELIVERED";
  const inIsrael = STAGE_ORDER.indexOf(stage) >= STAGE_ORDER.indexOf("IL_AIRPORT") && stage !== "EXCEPTION";
  const inactiveDays = latestAtDate ? Math.max(0, Math.floor((now.getTime() - latestAtDate.getTime()) / 86400000)) : null;
  const trackUrl = `https://t.17track.net/en#nums=${encodeURIComponent(raw.cjMailNo || raw.trackingNumber)}`;

  return {
    trackingNumber: raw.trackingNumber,
    cjMailNo: raw.cjMailNo || null,
    stage,
    progress: Math.max(0, STAGE_ORDER.indexOf(stage)),
    delivered,
    inIsrael,
    exception,
    latestRemark: latest?.remark || null,
    latestRemarkHe: latest ? translateRemark(latest.remark) : null,
    latestAt: latestAtDate ? latestAtDate.toISOString() : null,
    inactiveDays,
    statusHe: statusHe || (raw.trackingStatus ? `סטטוס: ${raw.trackingStatus}` : "אין עדיין סריקות למשלוח"),
    nextStepHe: NEXT_STEP_HE[stage],
    timelineHe: routes.slice(0, 12).map(route => ({
      at: parseCjTime(route.acceptTime)?.toISOString() || null,
      text: `${formatIsraelDate(parseCjTime(route.acceptTime))} · ${translateRemark(route.remark)}`.replace(/^ · /, ""),
    })),
    trackUrl,
  };
}

/** One sentence for a support reply: where it is, when that was, what comes next. */
export function describeForCustomer(status: ShipmentStatus): string {
  const when = status.latestAt ? ` (עדכון אחרון ${formatIsraelDate(new Date(status.latestAt))})` : "";
  return `${status.statusHe}${when}. ${status.nextStepHe}`;
}
