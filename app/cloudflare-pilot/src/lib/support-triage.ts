export type SupportTriageClass = "CUSTOMER_SUPPORT" | "SALES_QUESTION" | "REVIEW" | "IGNORE";

export interface SupportTriageDecision {
  classification: SupportTriageClass;
  confidence: number;
  language: "HEBREW" | "ENGLISH" | "MIXED" | "UNKNOWN";
  reasons: string[];
}

const HEBREW = /[\u0590-\u05ff]/g;
const LATIN = /[a-z]/gi;
const CUSTOMER_SUPPORT = /(?:הזמנ|חבילה|מעקב|משלוח|שליח|הגיע|קיבלתי|קבלתי|החזר|זיכוי|ביטול|כתובת|החלפ|בעיה|שימוש|צבע|גוון|שורש|לא עובד|לא נתפס|order|tracking|shipment|delivery|refund|cancel|address|received|product)/i;
const SALES_QUESTION = /(?:כמה (?:עולה|המשלוח|זמן המשלוח)|מחיר|עלות|איך מזמינים|איפה קונים|איזה גוון|איזה צבע|מתאים לי|יש במלאי|תוך כמה זמן|ימי עסקים|מבצע|אחריות|price|how much|shipping cost|delivery time|which shade|in stock|warranty)/i;
const AUTOMATED = /(?:mailer-daemon|postmaster|no-?reply|do-?not-?reply|notification|newsletter|unsubscribe|list-unsubscribe|delivery status notification|undeliverable)/i;
const BUSINESS_NOISE = /(?:invoice|חשבונית ספק|חשבונית מס|receipt|domain renewal|hosting|security alert|login attempt|password reset|partnership|collaboration|seo service|guest post|backlink|webinar|newsletter|digest|weekly report|monthly report|billing notice)/i;
const HUMAN_GREETING = /(?:היי|שלום|בוקר טוב|ערב טוב|צהריים טובים|hi|hello|good morning)/i;

function languageOf(text: string): SupportTriageDecision["language"] {
  const hebrew = (text.match(HEBREW) || []).length;
  const latin = (text.match(LATIN) || []).length;
  if (hebrew >= 3 && latin >= 6) return "MIXED";
  if (hebrew >= 3) return "HEBREW";
  if (latin >= 6) return "ENGLISH";
  return "UNKNOWN";
}

export function triageMailboxMessage(input: {
  direction: "INBOUND" | "OUTBOUND";
  fromAddress: string;
  subject: string;
  textBody: string;
  automated?: boolean;
}): SupportTriageDecision {
  const text = `${input.fromAddress}\n${input.subject}\n${input.textBody}`.slice(0, 12000);
  const language = languageOf(`${input.subject}\n${input.textBody}`);
  const reasons: string[] = [];

  if (input.automated || AUTOMATED.test(text)) {
    return { classification: "IGNORE", confidence: 0.99, language, reasons: ["AUTOMATED_SENDER_OR_LIST_MAIL"] };
  }

  const support = CUSTOMER_SUPPORT.test(text);
  const sales = SALES_QUESTION.test(text);
  const businessNoise = BUSINESS_NOISE.test(text);
  if (support) reasons.push("SUPPORT_INTENT");
  if (sales) reasons.push("PRE_SALE_INTENT");
  if (language === "HEBREW" || language === "MIXED") reasons.push("HEBREW_CUSTOMER_SIGNAL");
  if (HUMAN_GREETING.test(text)) reasons.push("HUMAN_MESSAGE_SIGNAL");
  if (businessNoise) reasons.push("BUSINESS_OR_SYSTEM_MAIL_SIGNAL");

  if (businessNoise && !support && !sales) {
    return { classification: "IGNORE", confidence: 0.96, language, reasons };
  }
  if (sales) return { classification: "SALES_QUESTION", confidence: 0.96, language, reasons };
  if (support) return { classification: "CUSTOMER_SUPPORT", confidence: language === "HEBREW" ? 0.96 : 0.9, language, reasons };
  if (language === "HEBREW" || language === "MIXED") {
    return { classification: "REVIEW", confidence: 0.78, language, reasons };
  }
  if (input.direction === "OUTBOUND") {
    return { classification: "REVIEW", confidence: 0.6, language, reasons: ["OUTBOUND_THREAD_NEEDS_CONTEXT"] };
  }
  return { classification: "IGNORE", confidence: 0.9, language, reasons: reasons.length ? reasons : ["NO_CUSTOMER_SUPPORT_SIGNAL"] };
}
