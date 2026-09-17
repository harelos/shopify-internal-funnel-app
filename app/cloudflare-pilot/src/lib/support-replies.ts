import type { SupportPolicyDecision } from "./support-policy.js";
import { describeForCustomer, type ShipmentStatus } from "./cj-tracking.js";

export interface DeterministicSupportDecision {
  decision: "REPLY" | "WAIT" | "ESCALATE";
  topic: string;
  confidence: number;
  replyText: string;
  reason: string;
  factsUsed: string[];
  unverifiedClaims: string[];
  model: string;
}

export const APPROVED_STORE_FACTS = [
  "Delivery is available throughout Israel and normally takes 5–12 business days.",
  "Shipping is free for orders above ILS 199.",
  "NovaHair currently offers six shades: black, dark brown, medium brown, light brown, purple and red. There is no blonde shade.",
  "The recommended four-bottle offer is ILS 239.",
  "Every order includes a coloring kit valued at ILS 79.",
  "The store offers a 60-day guarantee; any refund, cancellation or shade-change action still requires human review and verified eligibility.",
];

export function ownerReviewHoldingDraft(policy: SupportPolicyDecision): string {
  if (policy.topic === "PRODUCT_INFORMATION") {
    return [
      "היי,",
      "",
      "תודה על השאלה. חשוב לנו לתת לך מידע מדויק ומסודר.",
      "",
      "אני בודקת כעת את רשימת הרכיבים ואת פרטי האישור הרלוונטיים למוצר, ואחזור אלייך עם המידע המלא לאחר בדיקה.",
      "",
      "צוות Tiger Brands Global",
    ].join("\n");
  }
  if (["ORDER_STATUS", "DELIVERY_DISPUTE"].includes(policy.topic)) {
    return [
      "היי,",
      "",
      "תודה שכתבת לנו. אני בודקת עכשיו את פרטי ההזמנה והמעקב כדי לחזור אלייך עם עדכון מדויק, ולא עם תשובה כללית.",
      "",
      "אחזור אלייך לאחר הבדיקה.",
      "",
      "צוות Tiger Brands Global",
    ].join("\n");
  }
  if (["PRODUCT_RESULT", "PRODUCT_USAGE", "PRODUCT_SAFETY"].includes(policy.topic)) {
    return [
      "היי,",
      "",
      "תודה שכתבת ושיתפת אותנו. אני רוצה לבדוק את הפרטים כמו שצריך לפני שאכוון אותך, ולכן הפנייה עוברת עכשיו לבדיקה אישית.",
      "",
      "נחזור אלייך עם מענה מסודר לאחר שנבדוק את המקרה.",
      "",
      "צוות Tiger Brands Global",
    ].join("\n");
  }
  return [
    "היי,",
    "",
    "תודה שכתבת לנו. קיבלנו את הפנייה ואנחנו בודקים את הפרטים כדי לתת לך מענה מדויק.",
    "",
    "נחזור אלייך לאחר בדיקה.",
    "",
    "צוות Tiger Brands Global",
  ].join("\n");
}

function parsedDeliveryWindow(facts: string[]): { minimum: number; maximum: number; source: string } | null {
  for (const fact of facts) {
    if (!/(?:delivery|shipping|משלוח)/i.test(fact)) continue;
    const match = fact.match(/(\d+)\s*[–—-]\s*(\d+)\s*(?:business\s+days|ימי\s+עסקים)/i);
    if (!match) continue;
    const minimum = Number(match[1]);
    const maximum = Number(match[2]);
    if (minimum > 0 && maximum >= minimum) return { minimum, maximum, source: fact };
  }
  return null;
}

function parsedFreeShippingThreshold(facts: string[]): { amount: number; source: string } | null {
  for (const fact of facts) {
    if (!/(?:shipping\s+is\s+free|free\s+shipping|משלוח\s+חינם)/i.test(fact)) continue;
    const match = fact.match(/(?:above|over|מעל)\s*(?:ILS\s*|₪\s*)?(\d+(?:\.\d+)?)/i)
      || fact.match(/(\d+(?:\.\d+)?)\s*(?:ILS|₪)/i);
    if (!match) continue;
    const amount = Number(match[1]);
    if (amount > 0) return { amount, source: fact };
  }
  return null;
}

function formattedShekels(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function deterministicLowRiskDecision(input: {
  orderContext: unknown;
  policy: SupportPolicyDecision;
  approvedStoreFacts?: string[];
}): DeterministicSupportDecision | null {
  const approvedStoreFacts = input.approvedStoreFacts ?? APPROVED_STORE_FACTS;
  const deliveryWindow = parsedDeliveryWindow(approvedStoreFacts);
  const freeShipping = parsedFreeShippingThreshold(approvedStoreFacts);
  if (input.policy.topic === "GENERAL_SHIPPING") {
    if (!deliveryWindow || !freeShipping) return null;
    return {
      decision: "REPLY",
      topic: input.policy.topic,
      confidence: 0.99,
      replyText: [
        "היי 🌷",
        "",
        `המשלוח זמין לכל הארץ, וזמן המשלוח הרגיל הוא ${deliveryWindow.minimum}–${deliveryWindow.maximum} ימי עסקים. המשלוח חינם בהזמנה מעל ${formattedShekels(freeShipping.amount)} ₪.`,
        "",
        "אם תרצי, כתבי לנו איזה מוצר את שוקלת להזמין ונעזור לך לבדוק את האפשרות המתאימה.",
        "",
        "צוות Tiger Brands Global",
      ].join("\n"),
      reason: "Rendered from approved store delivery facts.",
      factsUsed: [deliveryWindow.source, freeShipping.source],
      unverifiedClaims: [],
      model: "approved-facts-v1",
    };
  }
  if (input.policy.topic !== "ORDER_STATUS" || !Array.isArray(input.orderContext) || input.orderContext.length === 0) return null;
  const order = input.orderContext[0] as any;
  if (order.cancelledAt || /REFUND|VOID/i.test(String(order.displayFinancialStatus || ""))) return null;
  const fulfillment = Array.isArray(order.fulfillments) ? order.fulfillments[0] : null;
  if (fulfillment?.deliveredAt || /DELIVERED/i.test(String(fulfillment?.displayStatus || ""))) return null;
  const trackingInfo = Array.isArray(fulfillment?.trackingInfo) ? fulfillment.trackingInfo.find((item: any) => item?.number) : null;
  const trackingNumber = String(trackingInfo?.number || "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 60);
  const orderName = /^#\d+$/.test(String(order.name || "")) ? String(order.name) : "שלך";
  const lines = ["היי 🌷", ""];
  const tracking = (order.tracking && typeof order.tracking === "object" ? order.tracking : null) as ShipmentStatus | null;
  const trackPage = `https://tigerbrandsglobal.com/apps/funnels/track?order=${encodeURIComponent(orderName.replace(/^#/, ""))}`;
  if (tracking && tracking.delivered) return null;
  if (trackingNumber && tracking && tracking.stage !== "UNKNOWN" && !tracking.exception) {
    // The verified CJ event, in the customer's words, with what happens next.
    lines.push(
      `בדקתי עכשיו את הזמנה ${orderName} מול חברת המשלוחים: ${describeForCustomer(tracking)}`,
      "",
      `מספר המעקב: ${tracking.cjMailNo || trackingNumber}`,
      "כל הסריקות, מעודכנות בזמן אמת:",
      trackPage,
    );
  } else if (trackingNumber) {
    lines.push(
      `בדקתי את הזמנה ${orderName}. היא כבר קיבלה מספר מעקב ונמצאת בתהליך המשלוח.`,
      "",
      `מספר המעקב: ${trackingNumber}`,
      "אפשר לראות את העדכונים כאן:",
      trackPage,
      "",
      deliveryWindow
        ? `זמן המשלוח הרגיל הוא ${deliveryWindow.minimum}–${deliveryWindow.maximum} ימי עסקים. ברגע שחברת המשלוחים תעדכן סריקה חדשה, היא תופיע בקישור.`
        : "ברגע שחברת המשלוחים תעדכן סריקה חדשה, היא תופיע בקישור.",
    );
  } else if (/UNFULFILLED|IN_PROGRESS|ON_HOLD|SCHEDULED/i.test(String(order.displayFulfillmentStatus || ""))) {
    lines.push(
      `בדקתי את הזמנה ${orderName}. היא נקלטה אצלנו ונמצאת כעת בהכנה למשלוח.`,
      "",
      deliveryWindow
        ? `זמן המשלוח הרגיל הוא ${deliveryWindow.minimum}–${deliveryWindow.maximum} ימי עסקים. ברגע שייווצר מספר מעקב, הוא יופיע בעדכון המשלוח.`
        : "ברגע שייווצר מספר מעקב, הוא יופיע בעדכון המשלוח.",
    );
  } else {
    return null;
  }
  lines.push("", "אנחנו כאן איתך עד שהחבילה תגיע.", "", "צוות Tiger Brands Global");
  return {
    decision: "REPLY",
    topic: input.policy.topic,
    confidence: 0.99,
    replyText: lines.join("\n"),
    reason: "Rendered from a verified Shopify order and approved store delivery facts.",
    factsUsed: ["Verified Shopify fulfillment status", trackingNumber ? "Verified Shopify tracking number" : "No tracking number is present yet", tracking?.latestRemark ? `Verified CJ tracking event: ${tracking.latestRemark}` : null, deliveryWindow?.source].filter(Boolean) as string[],
    unverifiedClaims: [],
    model: "verified-order-facts-v1",
  };
}

/**
 * The note a customer gets the moment her message is routed to a person.
 *
 * It deliberately answers nothing. It states only what is true at that second:
 * the message arrived, a person has it, an answer is coming. No timeframe is
 * promised, because the queue is worked by one owner and a missed promise here
 * costs more than the reassurance is worth. No dashes: they read as
 * machine-written Hebrew.
 */
export function escalationAcknowledgementReply(): string {
  return [
    "היי,",
    "",
    "קיבלנו את הפנייה שלך והיא הועברה לצוות המתאים אצלנו לבדיקה.",
    "",
    "נחזור אלייך עם תשובה מלאה. אם יש פרט נוסף שיעזור לנו, את מוזמנת להשיב כאן.",
    "",
    "תודה על הסבלנות,",
    "צוות Tiger Brands Global",
  ].join("\n");
}
