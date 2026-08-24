import type { SupportIntent, SupportToolPlanItem } from "./contracts.js";

export type SupportSkill = {
  intent: SupportIntent;
  description: string;
  patterns: RegExp[];
  baseConfidence: number;
  defaultTools: SupportToolPlanItem[];
};

const readOrder = (reason: string): SupportToolPlanItem => ({ tool: "READ_SHOPIFY_ORDER", mode: "READ", reason });
const readPolicy = (reason: string): SupportToolPlanItem => ({ tool: "READ_STORE_POLICY", mode: "READ", reason });
const readProduct = (reason: string): SupportToolPlanItem => ({ tool: "READ_PRODUCT_FACTS", mode: "READ", reason });
const readReturnStatus = (reason: string): SupportToolPlanItem => ({ tool: "READ_RETURN_STATUS", mode: "READ", reason });

export const supportSkills: SupportSkill[] = [
  {
    intent: "legal_chargeback",
    description: "Legal threat, chargeback, regulator or lawyer escalation.",
    patterns: [/chargeback/i, /lawyer/i, /legal action/i, /תביעה/i, /עורך דין/i, /חברת אשראי/i],
    baseConfidence: 0.94,
    defaultTools: [{ tool: "ESCALATE_HUMAN", mode: "INTERNAL", reason: "High-risk conversation must be reviewed by a human." }],
  },
  {
    intent: "shipping_status",
    description: "Where-is-my-order, tracking and shipment status.",
    patterns: [/where.*order/i, /tracking/i, /shipment status/i, /delivery status/i, /איפה.*הזמנה/i, /מעקב/i, /משלוח.*איפה/i],
    baseConfidence: 0.9,
    defaultTools: [readOrder("Order state is authoritative for WISMO."), { tool: "READ_TRACKING", mode: "READ", reason: "Use real tracking data when available." }],
  },
  {
    intent: "shipping_policy",
    description: "General delivery timing, regions, fees or shipping policy.",
    patterns: [/shipping policy/i, /how long.*shipping/i, /delivery time/i, /כמה זמן.*משלוח/i, /זמן משלוח/i, /משלוחים/i],
    baseConfidence: 0.82,
    defaultTools: [readPolicy("Shipping promises must come from approved store policy, never model memory.")],
  },
  {
    intent: "delivery_issue",
    description: "Package marked delivered but missing, stalled, lost or carrier problem.",
    patterns: [/delivered.*not.*received/i, /lost package/i, /stuck.*tracking/i, /לא קיבלתי/i, /מסומן.*נמסר/i, /אבד/i],
    baseConfidence: 0.88,
    defaultTools: [readOrder("Verify the order and fulfillment."), { tool: "READ_TRACKING", mode: "READ", reason: "Carrier/tracking state determines next steps." }, { tool: "ESCALATE_HUMAN", mode: "INTERNAL", reason: "Delivery exceptions can require carrier or replacement decisions." }],
  },
  {
    intent: "order_cancel",
    description: "Customer asks to cancel an order.",
    patterns: [/cancel.*order/i, /לבטל.*הזמנה/i, /ביטול.*הזמנה/i],
    baseConfidence: 0.93,
    defaultTools: [readOrder("Cancellation eligibility depends on current fulfillment state."), { tool: "PROPOSE_CANCEL_ORDER", mode: "PROPOSE_WRITE", reason: "Never cancel automatically in staging." }],
  },
  {
    intent: "address_change",
    description: "Customer wants to update shipping address.",
    patterns: [/change.*address/i, /wrong address/i, /update.*address/i, /שינוי.*כתובת/i, /כתובת.*לא נכונה/i],
    baseConfidence: 0.92,
    defaultTools: [readOrder("Address edit eligibility depends on fulfillment state."), { tool: "PROPOSE_ADDRESS_CHANGE", mode: "PROPOSE_WRITE", reason: "Address changes require confirmation and approval." }],
  },
  {
    intent: "order_change",
    description: "Change quantity, item, variant, shade or other order details.",
    patterns: [/change.*order/i, /remove.*item/i, /change.*item/i, /לשנות.*הזמנה/i, /להחליף.*בהזמנה/i],
    baseConfidence: 0.84,
    defaultTools: [readOrder("Order edits depend on current fulfillment state."), { tool: "PROPOSE_ORDER_EDIT", mode: "PROPOSE_WRITE", reason: "Order edits are never executed by the draft engine." }],
  },
  {
    intent: "return_status",
    description: "Customer asks for the status of an existing return.",
    patterns: [/return status/i, /where.*return/i, /status.*return/i, /סטטוס.*החזרה/i, /מה קורה.*החזרה/i],
    baseConfidence: 0.88,
    defaultTools: [readOrder("Confirm the associated order."), readReturnStatus("Return progress must come from an approved returns source.")],
  },
  {
    intent: "exchange_status",
    description: "Customer asks for the status of an existing exchange.",
    patterns: [/exchange status/i, /where.*exchange/i, /status.*exchange/i, /סטטוס.*החלפה/i, /מה קורה.*החלפה/i],
    baseConfidence: 0.88,
    defaultTools: [readOrder("Confirm the associated order."), readReturnStatus("Exchange progress must come from an approved returns/exchange source.")],
  },
  {
    intent: "exchange_request",
    description: "Customer asks to exchange a received item or variant.",
    patterns: [/exchange.*item/i, /exchange.*order/i, /swap.*item/i, /להחליף.*מוצר/i, /החלפה.*מוצר/i],
    baseConfidence: 0.9,
    defaultTools: [readOrder("Exchange eligibility needs the actual order."), readPolicy("Exchange terms must come from approved policy."), { tool: "PROPOSE_EXCHANGE", mode: "PROPOSE_WRITE", reason: "Exchange initiation remains approval-only." }],
  },
  {
    intent: "return_request",
    description: "Customer asks to return a received order.",
    patterns: [/return.*order/i, /return.*item/i, /להחזיר/i, /החזרה/i],
    baseConfidence: 0.88,
    defaultTools: [readOrder("Return eligibility needs the actual order."), readPolicy("Return terms must come from approved policy."), { tool: "PROPOSE_RETURN", mode: "PROPOSE_WRITE", reason: "Return initiation remains approval-only." }],
  },
  {
    intent: "refund_request",
    description: "Customer asks for money back.",
    patterns: [/refund/i, /money back/i, /החזר כספי/i, /זיכוי/i],
    baseConfidence: 0.9,
    defaultTools: [readOrder("Refund decisions require actual payment/order facts."), readPolicy("Refund eligibility must use approved policy."), { tool: "PROPOSE_REFUND", mode: "PROPOSE_WRITE", reason: "Refunds are never model-authorized." }],
  },
  {
    intent: "refund_status",
    description: "Customer asks when an already-issued refund will arrive.",
    patterns: [/refund status/i, /where.*refund/i, /when.*refund/i, /איפה.*הזיכוי/i, /מתי.*החזר/i],
    baseConfidence: 0.88,
    defaultTools: [readOrder("Use actual payment/refund state rather than estimating." )],
  },
  {
    intent: "damaged_item",
    description: "Received item is damaged or defective.",
    patterns: [/damaged/i, /broken/i, /defective/i, /פגום/i, /שבור/i, /נזילה/i],
    baseConfidence: 0.9,
    defaultTools: [readOrder("Verify purchased item and order."), { tool: "PROPOSE_RESHIP", mode: "PROPOSE_WRITE", reason: "Replacement or refund requires human policy approval." }],
  },
  {
    intent: "wrong_missing_item",
    description: "Wrong product, missing product or incomplete order.",
    patterns: [/wrong item/i, /missing item/i, /didn't receive.*item/i, /מוצר.*לא נכון/i, /חסר.*מוצר/i, /לא קיבלתי.*מוצר/i],
    baseConfidence: 0.9,
    defaultTools: [readOrder("Compare complaint to line items and fulfillment."), { tool: "PROPOSE_RESHIP", mode: "PROPOSE_WRITE", reason: "Replacement must remain approval-only." }],
  },
  {
    intent: "shade_recommendation",
    description: "Beauty-specific shade/color selection question.",
    patterns: [/which shade/i, /what color/i, /shade.*recommend/i, /איזה גוון/i, /איזה צבע/i, /מתאים לי.*גוון/i],
    baseConfidence: 0.88,
    defaultTools: [readProduct("Shade advice must use versioned product/shade facts." )],
  },
  {
    intent: "product_usage",
    description: "How to use, timing, frequency or product instructions.",
    patterns: [/how.*use/i, /instructions/i, /how long.*leave/i, /איך.*משתמש/i, /הוראות/i, /כמה זמן/i],
    baseConfidence: 0.86,
    defaultTools: [readProduct("Usage instructions must come from approved product facts." )],
  },
  {
    intent: "product_recommendation",
    description: "Customer asks which product is best for their goal.",
    patterns: [/which product/i, /recommend.*product/i, /what should i buy/i, /איזה מוצר/i, /מה מומלץ/i],
    baseConfidence: 0.8,
    defaultTools: [readProduct("Recommendations must be grounded in catalog facts." )],
  },
  {
    intent: "stock_request",
    description: "Product or variant availability question.",
    patterns: [/in stock/i, /available/i, /restock/i, /במלאי/i, /מתי.*מלאי/i],
    baseConfidence: 0.84,
    defaultTools: [readProduct("Inventory claims must come from Shopify/catalog data." )],
  },
  {
    intent: "discount_request",
    description: "Customer asks for a discount or coupon.",
    patterns: [/discount/i, /coupon/i, /promo code/i, /הנחה/i, /קופון/i],
    baseConfidence: 0.9,
    defaultTools: [{ tool: "REQUEST_SERVER_OFFER", mode: "INTERNAL", reason: "The model must never invent or authorize a discount." }],
  },
  {
    intent: "feedback",
    description: "Customer provides product, brand or service feedback that is not a direct transaction request.",
    patterns: [/feedback/i, /review/i, /wanted to say/i, /פידבק/i, /רציתי להגיד/i, /חוויה/i],
    baseConfidence: 0.72,
    defaultTools: [],
  },
  {
    intent: "thanks_no_reply",
    description: "Simple thank-you / conversation can normally close.",
    patterns: [/^\s*(thanks|thank you|thx|תודה|תודה רבה)[!.\s]*$/i],
    baseConfidence: 0.9,
    defaultTools: [],
  },
  {
    intent: "product_question",
    description: "General product question not covered by another skill.",
    patterns: [/product/i, /ingredient/i, /does it/i, /מוצר/i, /מרכיב/i],
    baseConfidence: 0.55,
    defaultTools: [readProduct("General product answers must be grounded in approved product facts." )],
  },
];

export function detectSupportIntent(subject: string | undefined, message: string): { intent: SupportIntent; confidence: number } {
  const corpus = `${subject || ""}\n${message}`.trim();
  for (const skill of supportSkills) {
    if (skill.patterns.some((pattern) => pattern.test(corpus))) {
      return { intent: skill.intent, confidence: skill.baseConfidence };
    }
  }
  return { intent: "other", confidence: 0.3 };
}

export function skillForIntent(intent: SupportIntent): SupportSkill | undefined {
  return supportSkills.find((skill) => skill.intent === intent);
}
