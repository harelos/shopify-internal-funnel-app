import type { DiscountDecision } from "./bot-sales-brain.js";

export interface BotOutputPolicyResult {
  text: string;
  redacted: boolean;
  blockedUnauthorizedOffer: boolean;
  blockedCouponClaim: boolean;
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
  // Customer-facing price questions are legitimate. Block only clearly internal
  // economics rather than generic phrases such as "עלות המוצר".
  return /(\bcogs\b|internal\s+margin|supplier\s+cost|landed\s+cost|עלות\s+(?:הספק|cj|פנימית)|מחיר\s+הספק|מרווח\s+פנימי|רווח\s+פנימי)/i.test(value);
}

function discountPercentages(value: string): number[] {
  const values: number[] = [];
  const patterns = [
    /(?:\bdiscount\b|הנחה|\boffer\b|מבצע).{0,48}?\b(\d{1,2}(?:\.\d+)?)\s*%/gi,
    /\b(\d{1,2}(?:\.\d+)?)\s*%.{0,48}?(?:\bdiscount\b|הנחה|\boffer\b|מבצע)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) {
      const pct = Number(match[1]);
      if (Number.isFinite(pct)) values.push(pct);
    }
  }
  return values;
}

function containsCouponCodeClaim(value: string): boolean {
  // A real code can only be mentioned after a coupon-allocation tool confirms it.
  // The current runtime has no such tool result, so code-like claims must fail closed.
  return /(?:קוד\s+(?:קופון|הנחה)|coupon\s+code|discount\s+code)\s*(?:הוא|is|:|-)?\s*[A-Z0-9_-]{4,}/i.test(value);
}

function approvedOfferFallback(pct: number): string {
  return `אני יכולה להציע לך כרגע ${pct}% הנחה. אם תרצי, אעזור לך לבחור את האפשרות המתאימה ואז נמשיך משם.`;
}

export function enforceBotOutputPolicy(raw: string, discount: DiscountDecision): BotOutputPolicyResult {
  let text = String(raw || "").trim().slice(0, 5000);
  const secretResult = redactSecrets(text);
  text = secretResult.text;
  let redacted = secretResult.redacted;
  let blockedUnauthorizedOffer = false;
  let blockedCouponClaim = false;

  if (containsInternalEconomics(text)) {
    redacted = true;
    text = "אני יכולה לעזור עם המוצר, המחיר שמוצג לך, משלוח או הזמנה — אבל לא עם מידע תפעולי פנימי של החנות.";
  }

  const percentages = discountPercentages(text);
  if (discount.action === "OFFER_DISCOUNT") {
    const wrongPercentage = percentages.some(value => Math.abs(value - discount.pct) > 0.0001);
    if (wrongPercentage) {
      blockedUnauthorizedOffer = true;
      redacted = true;
      text = approvedOfferFallback(discount.pct);
    }
  } else if (percentages.length > 0) {
    blockedUnauthorizedOffer = true;
    redacted = true;
    text = "אני לא יכולה לפתוח הנחה נוספת כרגע, אבל אני כן יכולה לעזור לך להבין איזו אפשרות הכי מתאימה ומה בדיוק מקבלים בכל חבילה.";
  }

  if (containsCouponCodeClaim(text)) {
    blockedCouponClaim = true;
    redacted = true;
    text = discount.action === "OFFER_DISCOUNT"
      ? approvedOfferFallback(discount.pct)
      : "אני לא יכולה להבטיח קוד הנחה שלא הוקצה על ידי המערכת. אני כן יכולה לעזור לך לבחור את האפשרות המתאימה.";
  }

  if (!text) text = "אני כאן לעזור עם המוצר, המשלוח או ההזמנה. מה תרצי לבדוק?";
  return { text, redacted, blockedUnauthorizedOffer, blockedCouponClaim };
}
