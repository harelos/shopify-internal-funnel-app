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
  // An IP demand arrived worded as an ordinary Hebrew support message and none
  // of these words appeared, so it scored as a customer question.
  { pattern: /עורך דין|תביעה|משטרה|consumer protection|lawyer|legal action|זכויות יוצרים|סימני? מסחר|הפרת זכויות|copyright|trademark|infringement|cease and desist/i, flag: "LEGAL_THREAT", topic: "LEGAL", risk: "HIGH" },
  { pattern: /להסיר אותי|להוציא אותי|אל תשלחו|לא לשלוח|unsubscribe|opt[ -]?out|stop emailing/i, flag: "MARKETING_OPT_OUT", topic: "MARKETING_OPT_OUT", risk: "HIGH" },
  { pattern: /מחיקת (?:מידע|נתונים)|פרטיות|delete my data|privacy request|data deletion/i, flag: "PRIVACY_REQUEST", topic: "PRIVACY", risk: "HIGH" },
  { pattern: /אלרג|פריחה|כוויה|נשרף|נשירה|פציע|רופא|בית חולים|allerg|rash|burn|injur/i, flag: "HEALTH_OR_SAFETY", topic: "PRODUCT_SAFETY", risk: "HIGH" },
  { pattern: /הונאה|רמאות|גנבתם|נוכל|scam|fraud/i, flag: "FRAUD_ALLEGATION", topic: "TRUST", risk: "HIGH" },
  { pattern: /החזר|זיכוי|refund|להחזיר את הכסף/i, flag: "REFUND_REQUEST", topic: "REFUND", risk: "HIGH" },
  { pattern: /לבטל|ביטול הזמנה|cancel (my )?order/i, flag: "CANCEL_REQUEST", topic: "CANCELLATION", risk: "HIGH" },
  // "הכתובת שלי לא נכונה" never matched the literal "כתובת לא נכונה", so a
  // wrong-address message fell through to the tracking rule and was answered
  // instead of escalated. Allow words between the noun and the complaint.
  { pattern: /שינוי כתובת|לשנות.*כתובת|כתובת.*(?:לא נכונה|לא נכון|שגויה|שגוי|טעות)|wrong address|change.*address/i, flag: "ADDRESS_CHANGE", topic: "ADDRESS_CHANGE", risk: "HIGH" },
  { pattern: /רשימת רכיבים|מה (?:יש|מכיל).*מוצר|אישור משרד הבריאות|משרד הבריאות|INCI|ingredients|regulatory approval/i, flag: "PRODUCT_OR_REGULATORY_INFORMATION", topic: "PRODUCT_INFORMATION", risk: "MEDIUM" },
  { pattern: /כמה (?:עולה )?(?:ה)?משלוח|עלות משלוח|תוך כמה זמן|כמה זמן (?:ה)?משלוח|ימי עסקים|shipping cost|delivery time|how long.*deliver/i, flag: "PRE_SALE_SHIPPING", topic: "GENERAL_SHIPPING", risk: "LOW" },
  { pattern: /מסומן(?:ת)? כנמסר|כתוב.*נמסר|לא קיבלתי.*(?:הזמנה|חבילה)|delivered.*(?:not|but)|marked.*delivered/i, flag: "DELIVERY_DISPUTE", topic: "DELIVERY_DISPUTE", risk: "MEDIUM" },
  // Customers do not write "מתי אקבל". They write "מתי אוכל לקבל", "מתי
  // ההזמנה תגיע", "טרם קיבלתי", "מה קורה עם ההזמנה". Those all used to fall
  // through to topic OTHER, which is not auto-sendable, so a plain "where is
  // my parcel" sat in review with the tracking facts already on the draft.
  // Every higher-risk rule sits earlier in this list and wins hits[0], so a
  // refund, cancellation, address change or delivery dispute still escalates
  // even when it also mentions the order.
  { pattern: /איפה ההזמנה|איפה החבילה|מספר מעקב|לא הגיע|טרם הגיע|טרם קיבלתי|עדיין לא קיבלתי|לא קיבלתי את ה(?:הזמנה|חבילה|מוצר)|סטטוס.*(?:הזמנה|משלוח)|מה (?:קורה|המצב|קרה) עם.*(?:הזמנה|משלוח|חבילה)|צפי.*(?:משלוח|לקבל)|מתי.*(?:יגיע|תגיע|להגיע|אגיע|אקבל|אוכל לקבל|מקבלת|מקבל)|מתי.*(?:יצא|נשלח)|(?:יצא|נשלח).*הזמנה|עדכון.*(?:משלוח|הזמנה)|לא קיבלתי.*עדכון|tracking|where is my order/i, flag: "ORDER_STATUS", topic: "ORDER_STATUS", risk: "LOW" },
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

/**
 * Topics the owner allows the AI to answer without reading it first.
 *
 * Widening this is a risk decision, not a code change: a wrong answer about a
 * refund, a payment dispute or what the product does to someone's hair costs
 * more than the time it saves. It is configurable so the owner can widen it
 * deliberately, and it defaults to the two topics that can be answered entirely
 * from verified order data and approved store facts.
 */
export function autoSendTopics(readEnv: (name: string) => string = () => ""): Set<string> {
  const configured = String(readEnv("SUPPORT_AUTOSEND_TOPICS") || "")
    .split(",").map(topic => topic.trim().toUpperCase()).filter(Boolean);
  // These are never auto-sendable, whatever the configuration says.
  const forbidden = new Set(["PRODUCT_SAFETY", "REFUND", "PAYMENT_DISPUTE", "DELIVERY_DISPUTE", "LEGAL", "REGULATORY"]);
  const allowed = configured.length ? configured : ["GENERAL_SHIPPING", "ORDER_STATUS"];
  return new Set(allowed.filter(topic => !forbidden.has(topic)));
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
  /** Defaults to the two topics answerable from verified facts alone. */
  allowedTopics?: Set<string>;
}): boolean {
  const canAnswerWithoutOrder = input.policy.topic === "GENERAL_SHIPPING";
  const allowed = input.allowedTopics ?? new Set(["GENERAL_SHIPPING", "ORDER_STATUS"]);
  const approvedAutoSendTopic = allowed.has(input.policy.topic);
  const recentEnough = input.messageAgeMinutes === undefined || input.messageAgeMinutes <= 72 * 60;
  const supportedLanguage = input.language === undefined || input.language === "HEBREW" || input.language === "MIXED";
  return input.automationMode === "AUTOSEND_LOW_RISK"
    && input.policy.riskLevel === "LOW"
    && approvedAutoSendTopic
    && !input.policy.mustEscalate
    && input.confidence >= 0.92
    && (input.hasVerifiedOrder || canAnswerWithoutOrder)
    && !input.hasUnverifiedClaims
    && recentEnough
    && input.latestMessageIsInbound !== false
    && supportedLanguage;
}

/**
 * Never acknowledge these. A holding note is still a reply from the support
 * mailbox: to a phisher it confirms the address is read by a human, to an
 * opt-out request it is one more email after she asked for none, and to a
 * privacy request it starts a clock without answering it.
 */
const NEVER_ACKNOWLEDGE = new Set(["FRAUD", "LEGAL", "PRIVACY", "MARKETING_OPT_OUT"]);

/**
 * Whether a customer whose message is going to a human should still get an
 * immediate note saying so.
 *
 * Silence is the worst answer: she wrote in, nothing came back, and she wrote
 * again. This does not answer her question and must never look like it does.
 * It exists so that "a human is reading this" arrives in seconds instead of
 * days, and it is sent once per inbound message, never repeatedly.
 *
 * The hard part is that the mailbox also receives phishing, supplier pitches,
 * newsletters and vendor threads, and triage marks those ACCEPTED too. A real
 * Israeli customer leaves `HEBREW_CUSTOMER_SIGNAL`, or has a matched Shopify
 * order; machine mail leaves `BUSINESS_OR_SYSTEM_MAIL_SIGNAL`.
 */
export function mayAutoAcknowledge(input: {
  enabled: boolean;
  automationMode: string;
  policy: SupportPolicyDecision;
  triageReasons: string[];
  hasVerifiedOrder: boolean;
  alreadyAcknowledged: boolean;
  messageAgeMinutes: number;
  latestMessageIsInbound: boolean;
  language?: string;
}): boolean {
  const reasons = new Set(input.triageReasons.map(reason => reason.trim().toUpperCase()).filter(Boolean));
  const looksLikeARealCustomer = input.hasVerifiedOrder || reasons.has("HEBREW_CUSTOMER_SIGNAL");
  const looksLikeMachineMail = reasons.has("BUSINESS_OR_SYSTEM_MAIL_SIGNAL") || reasons.has("SHIPMENT_MONITOR");
  // The owner only wants this week's customers chased; older threads are
  // history he has deliberately archived.
  const withinTheLastWeek = input.messageAgeMinutes <= 7 * 24 * 60;
  const supportedLanguage = input.language === undefined || input.language === "HEBREW" || input.language === "MIXED";
  return input.enabled
    && input.automationMode !== "OFF"
    && looksLikeARealCustomer
    && !looksLikeMachineMail
    && !NEVER_ACKNOWLEDGE.has(input.policy.topic)
    && !input.alreadyAcknowledged
    && withinTheLastWeek
    && input.latestMessageIsInbound
    && supportedLanguage;
}
