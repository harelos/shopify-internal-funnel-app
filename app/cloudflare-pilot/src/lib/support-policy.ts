export type SupportRisk = "LOW" | "MEDIUM" | "HIGH";

export interface SupportPolicyDecision {
  topic: string;
  riskLevel: SupportRisk;
  flags: string[];
  mustEscalate: boolean;
  priority: "NORMAL" | "HIGH" | "URGENT";
}

const rules: Array<{ pattern: RegExp; flag: string; topic: string; risk: SupportRisk }> = [
  { pattern: /charge\s?back|הכחשת עסקה|חברת האשראי|ביטול עסקה דרך/i, flag: "CHARGEBACK_OR_DISPUTE", topic: "PAYMENT_DISPUTE", risk: "HIGH" },
  { pattern: /עורך דין|תביעה|משטרה|משרד הבריאות|consumer protection|lawyer|legal action/i, flag: "LEGAL_THREAT", topic: "LEGAL", risk: "HIGH" },
  { pattern: /אלרג|פריחה|כוויה|נשרף|נשירה|פציע|רופא|בית חולים|allerg|rash|burn|injur/i, flag: "HEALTH_OR_SAFETY", topic: "PRODUCT_SAFETY", risk: "HIGH" },
  { pattern: /הונאה|רמאות|גנבתם|נוכל|scam|fraud/i, flag: "FRAUD_ALLEGATION", topic: "TRUST", risk: "HIGH" },
  { pattern: /החזר|זיכוי|refund|להחזיר את הכסף/i, flag: "REFUND_REQUEST", topic: "REFUND", risk: "HIGH" },
  { pattern: /לבטל|ביטול הזמנה|cancel (my )?order/i, flag: "CANCEL_REQUEST", topic: "CANCELLATION", risk: "HIGH" },
  { pattern: /שינוי כתובת|כתובת לא נכונה|wrong address|change.*address/i, flag: "ADDRESS_CHANGE", topic: "ADDRESS_CHANGE", risk: "HIGH" },
  { pattern: /כמה (?:עולה )?(?:ה)?משלוח|עלות משלוח|תוך כמה זמן|כמה זמן (?:ה)?משלוח|ימי עסקים|shipping cost|delivery time|how long.*deliver/i, flag: "PRE_SALE_SHIPPING", topic: "GENERAL_SHIPPING", risk: "LOW" },
  { pattern: /מסומן(?:ת)? כנמסר|כתוב.*נמסר|לא קיבלתי.*(?:הזמנה|חבילה)|delivered.*(?:not|but)|marked.*delivered/i, flag: "DELIVERY_DISPUTE", topic: "DELIVERY_DISPUTE", risk: "MEDIUM" },
  { pattern: /איפה ההזמנה|איפה החבילה|מספר מעקב|לא הגיע|צפי.*(?:משלוח|לקבל)|מתי.*(?:יגיע|אקבל)|tracking|where is my order/i, flag: "ORDER_STATUS", topic: "ORDER_STATUS", risk: "LOW" },
  { pattern: /איך משתמש|הוראות שימוש|איך לצבוע|how (do|to) use/i, flag: "HOW_TO_USE", topic: "PRODUCT_USAGE", risk: "MEDIUM" },
  { pattern: /לא עובד|לא צבע|לא נתפס|didn.?t work|no result/i, flag: "PRODUCT_RESULT", topic: "PRODUCT_RESULT", risk: "MEDIUM" },
];

export function evaluateSupportPolicy(text: string): SupportPolicyDecision {
  const hits = rules.filter(rule => rule.pattern.test(text));
  const riskLevel: SupportRisk = hits.some(hit => hit.risk === "HIGH")
    ? "HIGH"
    : hits.some(hit => hit.risk === "MEDIUM")
      ? "MEDIUM"
      : "LOW";
  return {
    topic: hits[0]?.topic ?? "OTHER",
    riskLevel,
    flags: [...new Set(hits.map(hit => hit.flag))],
    mustEscalate: riskLevel === "HIGH",
    priority: riskLevel === "HIGH" ? "URGENT" : riskLevel === "MEDIUM" ? "HIGH" : "NORMAL",
  };
}

export function mayAutoSend(input: {
  automationMode: string;
  policy: SupportPolicyDecision;
  confidence: number;
  hasVerifiedOrder: boolean;
  hasUnverifiedClaims: boolean;
  messageAgeMinutes?: number;
  latestMessageIsInbound?: boolean;
  language?: string;
}): boolean {
  const canAnswerWithoutOrder = input.policy.topic === "GENERAL_SHIPPING";
  const recentEnough = input.messageAgeMinutes === undefined || input.messageAgeMinutes <= 72 * 60;
  const supportedLanguage = input.language === undefined || input.language === "HEBREW" || input.language === "MIXED";
  return input.automationMode === "AUTOSEND_LOW_RISK"
    && input.policy.riskLevel === "LOW"
    && !input.policy.mustEscalate
    && input.confidence >= 0.92
    && (input.hasVerifiedOrder || canAnswerWithoutOrder)
    && !input.hasUnverifiedClaims
    && recentEnough
    && input.latestMessageIsInbound !== false
    && supportedLanguage;
}
