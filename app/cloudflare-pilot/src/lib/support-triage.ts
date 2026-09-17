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
const SUPPLIER_OR_OPERATIONS = /(?:sourcing|supplier|wholesale|private label|fulfillment quote|landed cost|shopify collective|mocra|\bsds\b|\bcoa\b|procurement|warehouse pre-stock|bundle fulfillment|shipping revolution|zendrop|cjdropshipping|hyperSKU|dropshipping fulfillment|qc-confirmed|quote request|factory direct|shenzhen|guangzhou|yiwu|alibaba|1688|trade assurance|dispatch quote)/i;
// Vendors and platforms the shop works with. Their mail reads like customer
// mail because it is full of the words "order", "delivery" and "refund", so it
// landed in the customer queue: in one week Visa, Shopify payout notices,
// Namecheap and a marketing newsletter were a third of the intake.
const OPERATIONS_SENDER = /@(?:[a-z0-9-]+\.)*(?:namecheap\.com|privateemail\.com|cloudflare\.com|railway\.app|github\.com|openrouter\.ai|chargeback\.io|visa\.com|mastercard\.com|convertkit\.com|kit\.com|klaviyo\.com|resend\.com|stripe\.com|paypal\.com|cjdropshipping\.com|meta\.com|facebookmail\.com|intercom\.io|zendesk\.com|gorgias\.com)$/i;

// Shopify sends both platform noise and forwarded shopper messages from the
// same address, so the address alone cannot decide.
const PLATFORM_SENDER = /@(?:[a-z0-9-]+\.)*shopify\.com$/i;
const PLATFORM_CUSTOMER_FORWARD = /(?:הודעת לקוח חדשה|new customer message|contact form|טופס יצירת קשר)/i;
const PLATFORM_NOISE = /(?:payout|payment on the way|your (?:bill|invoice)|subscription|app charge|capital|shipping label|weekly report|your week with)/i;
const HUMAN_GREETING = /(?:היי|שלום|בוקר טוב|ערב טוב|צהריים טובים|hi|hello|good morning)/i;
// A real platform notice never comes from a free webmail account. Mail that
// impersonates a platform's support while the sender is gmail, outlook, etc.
// is a phishing follow-up, not the platform and not a customer.
const FREE_WEBMAIL_SENDER = /@(?:gmail|googlemail|outlook|hotmail|live|yahoo|ymail|proton|protonmail|icloud|gmx|mail|aol|zoho)\.[a-z.]+$/i;
// Meta's page-verification template is the other half of this. It arrives in
// Hebrew addressed to "מנהל יקר", claims the page was verified or is about to
// lose its badge, and sends the owner to a "security centre" on a link the
// sender controls. Meta does not write from gmail either.
const IMPERSONATES_PLATFORM = /(?:shopify (?:support|team|billing)|תמיכה של shopify|צוות shopify|תזכורת אחרונה|התראה אחרונה|בעיות שלא נפתרו|לפני שיוחלו הגבלות|unresolved issues affecting your (?:store|site)|suspend(?:ed|ing)? your (?:store|account)|verify your (?:store|account) now|מנהל יקר|מרכז האבטחה|אישור אימות|אימות הדף|תג האימות|security c(?:entre|enter)|verification badge|page (?:has been )?verified|confirm your identity now)/i;
// Same tell, different costume. A rights holder writes from a firm or a
// company domain; an "official intellectual property notice" from a personal
// gmail account is the extortion template, not a lawyer. Treating it as a
// legal matter put it in the owner's queue every day and it is simply spam.
const CLAIMS_LEGAL_AUTHORITY = /(?:הודעה רשמית|קניין רוחני|זכויות יוצרים|הפרת זכויות|סימני? מסחר|דרישה להסרה|נדרשת התייחסות|הליכים משפטיים|copyright (?:infringement|violation|notice)|trademark (?:infringement|violation)|intellectual property|cease and desist|dmca|takedown notice|legal (?:notice|department))/i;

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
  const from = input.fromAddress.trim();
  if (FREE_WEBMAIL_SENDER.test(from) && IMPERSONATES_PLATFORM.test(`${input.subject}\n${input.textBody}`)) {
    return { classification: "IGNORE", confidence: 0.98, language, reasons: ["IMPERSONATED_PLATFORM_FROM_FREE_WEBMAIL"] };
  }
  if (FREE_WEBMAIL_SENDER.test(from) && CLAIMS_LEGAL_AUTHORITY.test(`${input.subject}\n${input.textBody}`)) {
    return { classification: "IGNORE", confidence: 0.97, language, reasons: ["LEGAL_CLAIM_FROM_FREE_WEBMAIL"] };
  }
  if (OPERATIONS_SENDER.test(from)) {
    return { classification: "IGNORE", confidence: 0.99, language, reasons: ["OPERATIONS_SERVICE_PROVIDER_SENDER"] };
  }
  if (PLATFORM_SENDER.test(from)) {
    // A forwarded contact-form message is a real shopper. Everything else the
    // platform sends is administrative and belongs nowhere near the queue.
    const forwarded = PLATFORM_CUSTOMER_FORWARD.test(`${input.subject}\n${input.textBody}`);
    if (!forwarded || PLATFORM_NOISE.test(input.subject)) {
      return { classification: "IGNORE", confidence: 0.97, language, reasons: ["PLATFORM_ADMINISTRATIVE_MAIL"] };
    }
    reasons.push("PLATFORM_FORWARDED_CUSTOMER_MESSAGE");
  }

  const support = CUSTOMER_SUPPORT.test(text);
  const sales = SALES_QUESTION.test(text);
  const businessNoise = BUSINESS_NOISE.test(text);
  const supplierOrOperations = SUPPLIER_OR_OPERATIONS.test(text);
  if (support) reasons.push("SUPPORT_INTENT");
  if (sales) reasons.push("PRE_SALE_INTENT");
  if (language === "HEBREW" || language === "MIXED") reasons.push("HEBREW_CUSTOMER_SIGNAL");
  if (HUMAN_GREETING.test(text)) reasons.push("HUMAN_MESSAGE_SIGNAL");
  if (businessNoise) reasons.push("BUSINESS_OR_SYSTEM_MAIL_SIGNAL");
  if (supplierOrOperations) reasons.push("SUPPLIER_OR_OPERATIONS_SIGNAL");

  if ((businessNoise && !support && !sales) || (supplierOrOperations && language === "ENGLISH")) {
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
