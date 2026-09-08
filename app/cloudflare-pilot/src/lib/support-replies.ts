import type { SupportPolicyDecision } from "./support-policy.js";

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
  "NovaHair currently offers five shades.",
  "The recommended four-bottle offer is ILS 239.",
  "Every order includes a coloring kit valued at ILS 79.",
  "The store offers a 60-day guarantee; any refund, cancellation or shade-change action still requires human review and verified eligibility.",
];

export function deterministicLowRiskDecision(input: {
  orderContext: unknown;
  policy: SupportPolicyDecision;
}): DeterministicSupportDecision | null {
  if (input.policy.topic === "GENERAL_SHIPPING") {
    return {
      decision: "REPLY",
      topic: input.policy.topic,
      confidence: 0.99,
      replyText: [
        "היי 🌷",
        "",
        "המשלוח זמין לכל הארץ, וזמן המשלוח הרגיל הוא 5–12 ימי עסקים. המשלוח חינם בהזמנה מעל 199 ₪.",
        "",
        "אם תרצי, כתבי לנו איזה מוצר את שוקלת להזמין ונעזור לך לבדוק את האפשרות המתאימה.",
        "",
        "צוות Tiger Brands Global",
      ].join("\n"),
      reason: "Rendered from approved store delivery facts.",
      factsUsed: [APPROVED_STORE_FACTS[0], APPROVED_STORE_FACTS[1]],
      unverifiedClaims: [],
      model: "approved-facts-v1",
    };
  }
  if (input.policy.topic !== "ORDER_STATUS" || !Array.isArray(input.orderContext) || input.orderContext.length === 0) return null;
  const order = input.orderContext[0] as any;
  if (order.cancelledAt || /REFUND|VOID/i.test(String(order.displayFinancialStatus || ""))) return null;
  const fulfillment = Array.isArray(order.fulfillments) ? order.fulfillments[0] : null;
  if (fulfillment?.deliveredAt || /DELIVERED/i.test(String(fulfillment?.displayStatus || ""))) return null;
  const tracking = Array.isArray(fulfillment?.trackingInfo) ? fulfillment.trackingInfo.find((item: any) => item?.number) : null;
  const trackingNumber = String(tracking?.number || "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 60);
  const orderName = /^#\d+$/.test(String(order.name || "")) ? String(order.name) : "שלך";
  const lines = ["היי 🌷", ""];
  if (trackingNumber) {
    lines.push(
      `בדקתי את הזמנה ${orderName}. היא כבר קיבלה מספר מעקב ונמצאת בתהליך המשלוח.`,
      "",
      `מספר המעקב: ${trackingNumber}`,
      "אפשר לראות את העדכונים כאן:",
      `https://tigerbrandsglobal.com/apps/17TRACK?nums=${encodeURIComponent(trackingNumber)}`,
      "",
      "זמן המשלוח הרגיל הוא 5–12 ימי עסקים. ברגע שחברת המשלוחים תעדכן סריקה חדשה, היא תופיע בקישור.",
    );
  } else if (/UNFULFILLED|IN_PROGRESS|ON_HOLD|SCHEDULED/i.test(String(order.displayFulfillmentStatus || ""))) {
    lines.push(
      `בדקתי את הזמנה ${orderName}. היא נקלטה אצלנו ונמצאת כעת בהכנה למשלוח.`,
      "",
      "זמן המשלוח הרגיל הוא 5–12 ימי עסקים. ברגע שייווצר מספר מעקב, הוא יופיע בעדכון המשלוח.",
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
    factsUsed: ["Verified Shopify fulfillment status", trackingNumber ? "Verified Shopify tracking number" : "No tracking number is present yet", APPROVED_STORE_FACTS[0]],
    unverifiedClaims: [],
    model: "verified-order-facts-v1",
  };
}
