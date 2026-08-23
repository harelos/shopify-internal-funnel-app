import type { DiscountDecision } from "./bot-sales-brain.js";

export interface BotOutputPolicyResult {
  text: string;
  redacted: boolean;
  blockedUnauthorizedOffer: boolean;
}

const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bshpat_[A-Za-z0-9_-]{12,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+\/-]{16,}\b/gi,
  /\b(?:api[_ -]?key|access[_ -]?token|client[_ -]?secret)\s*[:=]\s*[A-Za-z0-9._~+\/-]{8,}\b/gi,
];

function redactSecrets(value: string): { text: string; redacted: boolean } {
  let text = value;
  let redacted = false;
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, () => {
      redacted = true;
      return "[redacted]";
    });
  }
  return { text, redacted };
}

function containsInternalEconomics(value: string): boolean {
  return /(\bcogs\b|internal\s+margin|supplier\s+cost|עלות\s+(?:הספק|cj|מוצר)|מרווח\s+פנימי)/i.test(value);
}

function containsUnauthorizedDiscount(value: string): boolean {
  return /(?:\bdiscount\b|הנחה|קופון|\bcoupon\b).{0,40}\b\d{1,2}(?:\.\d+)?\s*%|\b\d{1,2}(?:\.\d+)?\s*%.{0,40}(?:\bdiscount\b|הנחה|קופון|\bcoupon\b)/i.test(value);
}

export function enforceBotOutputPolicy(raw: string, discount: DiscountDecision): BotOutputPolicyResult {
  let text = String(raw || "").trim().slice(0, 5000);
  const secretResult = redactSecrets(text);
  text = secretResult.text;
  let redacted = secretResult.redacted;

  if (containsInternalEconomics(text)) {
    redacted = true;
    text = "אני יכולה לעזור עם המוצר, המחיר שמוצג לך, משלוח או הזמנה — אבל לא עם מידע תפעולי פנימי של החנות.";
  }

  const unauthorized = discount.action !== "OFFER_DISCOUNT" && containsUnauthorizedDiscount(text);
  if (unauthorized) {
    redacted = true;
    text = "אני לא יכולה לפתוח הנחה נוספת כרגע, אבל אני כן יכולה לעזור לך להבין איזו אפשרות הכי מתאימה ומה בדיוק מקבלים בכל חבילה.";
  }

  if (!text) text = "אני כאן לעזור עם המוצר, המשלוח או ההזמנה. מה תרצי לבדוק?";
  return { text, redacted, blockedUnauthorizedOffer: unauthorized };
}
