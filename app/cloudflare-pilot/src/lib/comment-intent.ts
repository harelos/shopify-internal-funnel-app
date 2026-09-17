/**
 * Reads a Hebrew comment on a NovaHair ad and decides what to do about it.
 *
 * Comments on a live ad are read by every future buyer, so an unanswered
 * "I ordered and it never came" costs more than the order did. The previous
 * classifier put scam warnings and "doesn't colour anything" in the same
 * positive_neutral bucket as "perfect", which is why nothing useful could be
 * automated from it.
 *
 * Only intents that can be answered from verified store facts get a written
 * reply. Anything touching skin, health, pregnancy, ingredients or an
 * accusation is never answered automatically, however obvious it looks.
 */
export type CommentIntent =
  | "MARKETPLACE_PRICE_CLAIM"
  | "DAMAGED_ON_ARRIVAL"
  | "DELIVERY_COMPLAINT"
  | "PRODUCT_NOT_WORKING"
  | "TRUST_ATTACK"
  | "SHADE_QUESTION"
  | "SHIPPING_QUESTION"
  | "PAYMENT_QUESTION"
  | "PRICE_QUESTION"
  | "SAFETY_OR_HEALTH"
  | "PRAISE"
  | "TAG_ONLY"
  | "OTHER";

export type CommentAction = "REPLY" | "REPLY_AND_HIDE" | "HIDE" | "ESCALATE" | "IGNORE";

export interface CommentDecision {
  intent: CommentIntent;
  action: CommentAction;
  /** The exact text to post, or null when nothing may be posted automatically. */
  reply: string | null;
  /** Why, in the owner's terms, for the dashboard and the audit row. */
  reason: string;
  /** Kept for the existing CommentGuardianComment.classification column. */
  classification: "severe_negative" | "question" | "positive_neutral" | "needs_human" | "marketplace_price_claim";
}

const has = (text: string, patterns: RegExp[]) => patterns.some(pattern => pattern.test(text));

/**
 * Anything here is never answered by a machine. A wrong word about skin,
 * allergies, pregnancy or what is inside the bottle is a different kind of
 * mistake from a wrong delivery date.
 */
const HEALTH = [
  /אלרג/, /רגישות/, /גירוי/, /כווי/, /קרקפת/, /עור/, /הריון/, /הרה/, /מניק/, /תינוק/,
  /מרכיב/, /רכיב/, /כימיק/, /אמוניה/, /פי\.?פי\.?די/, /ppd/i, /תופעות לוואי/, /בטיח/,
  /משרד הבריאות/, /אישור/, /סרטן/, /מסרטן/, /רופא/, /הנקה/,
];
/**
 * "You can get this on AliExpress for 20 shekels" under a live ad ends the sale
 * for everybody who reads it, and there is no reply that wins the argument.
 * The previous guardian already hid these, and that rule was right.
 */
const MARKETPLACE_PRICE_CLAIM = [
  /ali\s*express/i, /aliexpress/i, /אלי\s*אקספרס/, /עלי\s*אקספרס/, /עליאקספרס/, /אליאקספרס/,
  /temu/i, /טמו/, /שיין/, /shein/i, /איביי/, /ebay/i, /wish/i,
];
const DELIVERY_COMPLAINT = [
  /לא הגיע/, /לא קיבלתי/, /לא הגיעה/, /עדיין לא/, /מחכה כבר/, /איפה ההזמנה/, /איפה החבילה/,
  /לא שלחו/, /שבועיים/, /חודש ולא/, /לא נשלח/, /עד שזה מגיע/, /מגיע לפחות חודש/,
  // Wrote in and nobody came back to them. Same promise: give us the order number.
  /אין מענה/, /לא עונים/, /לא חוזרים אלי/, /אין תשובה/, /שלחתי מיילים/,
];
/**
 * A parcel that arrived smashed is a different apology from one that has not
 * arrived: telling her "we will check where your package is" when it is already
 * on her counter in pieces reads as not having listened.
 */
const DAMAGED_ON_ARRIVAL = [/שבור/, /מפוצץ/, /מרוסק/, /פגום/, /נשפך/, /דלף/, /חסר בחבילה/, /הגיע ריק/];
const NOT_WORKING = [
  /לא עובד/, /לא עבד/, /לא צובע/, /לא צבע/, /לא כיס/, /לא עשה/, /לא שווה/, /התאכזב/, /אכזבה/, /התבדית/,
  /בולשיט/, /חירטוט/, /חבל על הכסף/, /דיס המלצה/, /לא ממליצ/, /לא אקנה/, /הטעי/, /כתמים/,
  /שקר וכזב/, /לא משנה כלום/, /לא עשה כלום/,
];
const TRUST_ATTACK = [
  // "נוכל" is also the ordinary word for "we will be able to", so it only counts
  // as an accusation when it stands alone: "שנוכל להתנסות" is a polite request.
  /(?<![א-ת])נוכלים?(?![א-ת])/, /רמא/, /הונא/, /תרמית/, /זהירות/, /אל תקנ/, /אל תזמינ/, /לא אמין/,
  /מזויף/, /סקאם/, /scam/i, /לבדוק בגוגל/, /עוקץ/,
];
/** Prices change with the bundle, so no single public answer is true. */
const PRICE_QUESTION = [/מחיר/, /כמה עולה/, /כמה זה עולה/, /עלות המוצר/, /כמה שקל/, /יקר מדי/];
const SHADE_QUESTION = [/בלונד/, /בלונדינ/, /גוון/, /צבעים/, /איזה צבע/, /יש שחור/, /שטני/, /ג׳ינג/];
/**
 * "My hair is dark brown and I want slightly lighter, which do I buy?" is the
 * commonest sales question on these ads and never uses the word "גוון".
 */
const SHADE_NAME = /(חום כהה|חום בינוני|חום בהיר|שחור|סגול|אדום|בלונד)/;
const asksAboutShade = (message: string) =>
  has(message, SHADE_QUESTION) || (SHADE_NAME.test(message) && /\?/.test(message));
const SHIPPING_QUESTION = [/כמה זמן/, /מתי יגיע/, /זמן משלוח/, /משלוח עד הבית/, /דמי משלוח/, /עלות משלוח/, /שליח/];
const PAYMENT_QUESTION = [/מזומן/, /תשלומים/, /אשראי/, /ביט/, /paypal/i, /לשלם/];
const PRAISE = [/מושלם/, /מעולה/, /ממליצה בחום/, /אהבתי/, /תודה רבה/, /עובד מצוין/, /תוצאה מושלמת/, /מדהים/];

/** A comment that is only a person's name is a tag, not a question. */
function isTagOnly(message: string): boolean {
  const stripped = message.replace(/[\p{P}\p{S}\p{Emoji_Presentation}]/gu, " ").trim();
  if (!stripped) return true;
  const words = stripped.split(/\s+/);
  return words.length <= 3 && !/[?؟]/.test(message) && words.every(word => /^[\p{L}]+$/u.test(word));
}

/**
 * Verified from the Shopify catalogue on 2026-09-16: six shades, no blonde.
 * A shade list is the single most common question on these ads and the one
 * answer that is safe to give without a person.
 */
export const SHADES_HE = ["שחור", "חום כהה", "חום בינוני", "חום בהיר", "סגול", "אדום"];

const REPLY = {
  delivery: "היי, מצטערים על ההמתנה 🌷 שלחי לנו הודעה פרטית עם מספר ההזמנה והשם שבו הוזמנה, ונבדוק איפה החבילה ונחזור אלייך עם תשובה.",
  damaged: "היי, מצטערים מאוד שהחבילה הגיעה במצב כזה 🌷 שלחי לנו הודעה פרטית עם מספר ההזמנה ותמונה של מה שהגיע, ונטפל בזה מולך.",
  notWorking: "מצטערים לשמוע 🌷 שלחי לנו הודעה פרטית עם מספר ההזמנה והגוון שבו השתמשת, ונבדוק את המקרה יחד איתך.",
  shade: `היי 🌷 הגוונים הקיימים כרגע: ${SHADES_HE.join(", ")}. אין לנו גוון בלונד, והגוון הבהיר ביותר הוא חום בהיר. אם תכתבי לנו בפרטי מה צבע השיער שלך, נשמח לכוון לגוון המתאים.`,
  shipping: "היי 🌷 המשלוח מגיע לכל הארץ תוך 5–12 ימי עסקים, והוא חינם בהזמנה מעל 199 ₪. אחרי השליחה נשלח לך מספר מעקב לצפייה בסטטוס.",
  praise: "תודה רבה ששיתפת אותנו 🌷 שמחים מאוד לשמוע.",
};

export function decideCommentAction(input: { message: string; isFromPage: boolean; alreadyReplied: boolean }): CommentDecision {
  const message = String(input.message || "").trim();
  if (input.isFromPage) {
    return { intent: "OTHER", action: "IGNORE", reply: null, reason: "The page's own comment.", classification: "positive_neutral" };
  }
  if (!message) {
    return { intent: "TAG_ONLY", action: "IGNORE", reply: null, reason: "No text to answer.", classification: "positive_neutral" };
  }

  // Health and regulatory questions go to a person before anything else is
  // considered, even when they also look like a shade question.
  if (has(message, HEALTH)) {
    return {
      intent: "SAFETY_OR_HEALTH", action: "ESCALATE", reply: null,
      reason: "Mentions skin, health, pregnancy, ingredients or approval. Never answered automatically.",
      classification: "needs_human",
    };
  }
  // Hidden rather than answered, and ahead of the accusation check, because
  // these are usually worded as a warning and arguing about price loses.
  if (has(message, MARKETPLACE_PRICE_CLAIM)) {
    return {
      intent: "MARKETPLACE_PRICE_CLAIM", action: "HIDE", reply: null,
      reason: "Points buyers at a marketplace listing under a paid ad. Hidden, not argued with.",
      classification: "marketplace_price_claim",
    };
  }
  if (has(message, TRUST_ATTACK)) {
    return {
      intent: "TRUST_ATTACK", action: "ESCALATE", reply: null,
      reason: "Accuses the business publicly on a live ad. A canned answer makes this worse; decide the wording yourself.",
      classification: "severe_negative",
    };
  }
  if (has(message, DAMAGED_ON_ARRIVAL)) {
    return {
      intent: "DAMAGED_ON_ARRIVAL", action: input.alreadyReplied ? "IGNORE" : "REPLY_AND_HIDE", reply: REPLY.damaged,
      reason: "Says the parcel arrived damaged. Answered publicly and taken out of the ad's comment stream.",
      classification: "severe_negative",
    };
  }
  if (has(message, DELIVERY_COMPLAINT)) {
    return {
      intent: "DELIVERY_COMPLAINT", action: input.alreadyReplied ? "IGNORE" : "REPLY_AND_HIDE", reply: REPLY.delivery,
      reason: "Says the order has not arrived. Answered publicly and taken out of the ad's comment stream.",
      classification: "severe_negative",
    };
  }
  if (has(message, NOT_WORKING)) {
    return {
      intent: "PRODUCT_NOT_WORKING", action: input.alreadyReplied ? "IGNORE" : "REPLY_AND_HIDE", reply: REPLY.notWorking,
      reason: "Says the product did not work. Answered publicly and taken out of the ad's comment stream.",
      classification: "severe_negative",
    };
  }
  if (has(message, PAYMENT_QUESTION)) {
    return {
      intent: "PAYMENT_QUESTION", action: "ESCALATE", reply: null,
      reason: "Asks how to pay. The store has no approved public answer about payment methods yet.",
      classification: "question",
    };
  }
  // Checked before the shade question, so "why does black cost more than light
  // brown?" is not answered with a list of shades.
  if (has(message, PRICE_QUESTION)) {
    return {
      intent: "PRICE_QUESTION", action: "ESCALATE", reply: null,
      reason: "Asks about price. The price depends on the bundle, so there is no one public answer to give.",
      classification: "question",
    };
  }
  if (asksAboutShade(message)) {
    return {
      intent: "SHADE_QUESTION", action: input.alreadyReplied ? "IGNORE" : "REPLY", reply: REPLY.shade,
      reason: "Asks which shades exist. Answered from the catalogue.",
      classification: "question",
    };
  }
  if (has(message, SHIPPING_QUESTION)) {
    return {
      intent: "SHIPPING_QUESTION", action: input.alreadyReplied ? "IGNORE" : "REPLY", reply: REPLY.shipping,
      reason: "Asks about delivery. Answered from approved store facts.",
      classification: "question",
    };
  }
  if (has(message, PRAISE)) {
    return {
      intent: "PRAISE", action: input.alreadyReplied ? "IGNORE" : "REPLY", reply: REPLY.praise,
      reason: "A happy customer on a live ad, worth answering.",
      classification: "positive_neutral",
    };
  }
  if (isTagOnly(message)) {
    return { intent: "TAG_ONLY", action: "IGNORE", reply: null, reason: "Tagging a friend, no question asked.", classification: "positive_neutral" };
  }
  return {
    intent: "OTHER", action: "ESCALATE", reply: null,
    reason: "No verified answer covers this comment.",
    classification: "needs_human",
  };
}
