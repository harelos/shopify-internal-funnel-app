import type { SupportClassification, SupportMessageInput } from "./types.js";

const rules: Array<{ category: SupportClassification["category"]; patterns: RegExp[] }> = [
  { category: "shipping_tracking", patterns: [/מעקב/i, /משלוח/i, /איפה.*הזמנה/i, /tracking/i, /delivery/i, /shipment/i] },
  { category: "refund_return", patterns: [/החזר/i, /להחזיר/i, /ביטול/i, /refund/i, /return/i, /cancel/i] },
  { category: "address_change", patterns: [/כתובת/i, /address/i] },
  { category: "damaged_wrong_item", patterns: [/פגום/i, /שבור/i, /מוצר.*לא נכון/i, /wrong item/i, /damaged/i] },
  { category: "shade_product_question", patterns: [/גוון/i, /צבע/i, /shade/i, /color/i, /colour/i] },
  { category: "product_usage", patterns: [/איך.*משתמש/i, /הוראות/i, /כמה זמן/i, /how.*use/i, /instructions/i] },
  { category: "order_status", patterns: [/סטטוס/i, /הזמנה/i, /order status/i, /order/i] },
];

export function classifySupportMessage(message: SupportMessageInput): SupportClassification {
  const corpus = `${message.subject}\n${message.text}`;
  const matched = rules.find((rule) => rule.patterns.some((pattern) => pattern.test(corpus)));
  const urgency = /דחוף|מייד|עורך דין|תביעה|chargeback|urgent|lawyer|legal/i.test(corpus)
    ? "high"
    : "normal";
  const category = matched?.category || "other";

  return {
    category,
    confidence: matched ? 0.72 : 0.35,
    urgency,
    summary: message.text.replace(/\s+/g, " ").trim().slice(0, 240),
    requiresHuman: urgency === "high" || ["refund_return", "damaged_wrong_item"].includes(category),
  };
}
