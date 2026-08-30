import type { BotVerifiedOrderSummary } from "./bot-shopify-tools.js";

export interface ParsedOrderVerification {
  orderName: string | null;
  email: string | null;
  phone: string | null;
}

function normalizePhone(value: string): string {
  return value.replace(/[^+\d]/g, "").slice(0, 24);
}

function orderFromText(text: string): string | null {
  const patterns = [
    /(?:^|\s)#([A-Za-z0-9_-]{3,40})(?:\s|$|[.,!?])/i,
    /(?:מס(?:פר)?\s*)?הזמנה\s*[:#-]?\s*([A-Za-z0-9_-]{3,40})/i,
    /\border(?:\s*(?:number|no\.?|#))?\s*[:#-]?\s*([A-Za-z0-9_-]{3,40})\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].replace(/^#+/, "").slice(0, 40);
  }
  return null;
}

function emailFromText(text: string): string | null {
  const match = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  return match?.[0]?.toLowerCase() || null;
}

function phoneFromText(text: string): string | null {
  const match = text.match(/(?:טלפון|נייד|phone|mobile)\s*[:=-]?\s*(\+?\d[\d\s().-]{7,20})/i);
  if (!match?.[1]) return null;
  const normalized = normalizePhone(match[1]);
  const digits = normalized.replace(/\D/g, "");
  return digits.length >= 8 ? normalized : null;
}

export function extractOrderVerification(texts: string[]): ParsedOrderVerification {
  let orderName: string | null = null;
  let email: string | null = null;
  let phone: string | null = null;
  for (const raw of texts) {
    const text = String(raw || "");
    orderName ||= orderFromText(text);
    email ||= emailFromText(text);
    phone ||= phoneFromText(text);
  }
  return { orderName, email, phone };
}

export function missingOrderVerificationReply(parsed: ParsedOrderVerification): string | null {
  if (!parsed.orderName) {
    return "בשמחה. מה מספר ההזמנה? אפשר לכתוב אותו כמו שהוא מופיע באישור ההזמנה, למשל #1234.";
  }
  if (!parsed.email && !parsed.phone) {
    return "כדי לוודא שזו ההזמנה שלך לפני שאני מציגה מידע, כתבי את כתובת האימייל או את מספר הטלפון ששימשו בהזמנה.";
  }
  return null;
}

function fulfillmentLabel(value: string | null): string {
  const normalized = String(value || "").toUpperCase();
  if (normalized === "FULFILLED") return "נשלחה";
  if (normalized === "PARTIALLY_FULFILLED") return "נשלחה חלקית";
  if (normalized === "UNFULFILLED") return "עדיין לא נשלחה";
  if (normalized === "ON_HOLD") return "בהמתנה";
  if (normalized === "IN_PROGRESS") return "בטיפול";
  return value ? String(value) : "לא זמין כרגע";
}

export function formatVerifiedTrackingReply(order: BotVerifiedOrderSummary): string {
  const tracking = order.fulfillments.flatMap(item => item.trackingInfo || []).filter(item => item.number || item.url);
  const status = fulfillmentLabel(order.displayFulfillmentStatus);
  const first = tracking[0];
  const lines = [`אימתתי את ההזמנה ${order.name}. סטטוס המשלוח שמופיע כרגע במערכת הוא: ${status}.`];
  if (first?.number) {
    lines.push(`מספר המעקב הוא ${first.number}${first.company ? ` דרך ${first.company}` : ""}.`);
  } else if (first?.url) {
    lines.push("קיים קישור מעקב במערכת, אבל אין מספר מעקב נפרד להצגה.");
  } else {
    lines.push("כרגע Shopify לא מחזיר מספר מעקב להזמנה הזאת.");
  }
  lines.push("אני לא מוסיפה הערכת הגעה שלא מופיעה במקור הרשמי.");
  return lines.join("\n\n");
}
