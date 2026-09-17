import { describeForCustomer, type ShipmentStatus } from "./cj-tracking.js";

/**
 * The words a customer receives about a late or arriving parcel. Pure text,
 * kept apart from the cron so it can be tested without a Worker runtime.
 */
export const GIFT_PERCENT = 15;

export function firstName(order: any): string {
  return String(order?.customer?.firstName || "").trim().split(/\s+/)[0] || "";
}

export function shadeLine(order: any): string {
  const items = (order?.lineItems?.nodes || []) as Array<{ name: string; variantTitle: string | null; quantity: number }>;
  // Shopify names the only variant "Default Title", and this store shows that
  // in Hebrew, so both spellings have to be excluded or the email greets the
  // customer with "(ברירת מחדל)" as if it were a shade.
  const shades = items.map(item => item.variantTitle)
    .filter((v): v is string => Boolean(v && !/default title/i.test(v) && v.trim() !== "ברירת מחדל"));
  return shades.length ? ` (${[...new Set(shades)].slice(0, 2).join(", ")})` : "";
}

export function greet(name: string): string {
  return name ? `היי ${name} 🌷` : "היי 🌷";
}

export function arrivedIsraelText(order: any, status: ShipmentStatus): string {
  return [
    greet(firstName(order)),
    "",
    `חדשות טובות: החבילה שלך מהזמנה ${order.name}${shadeLine(order)} כבר בישראל.`,
    `${describeForCustomer(status)}`,
    "",
    "ההודעה עם נקודת האיסוף מגיעה ב-SMS למספר שמופיע בהזמנה, אז שווה לשים לב גם להודעות ממספר לא מוכר.",
    "",
    `לצפייה בכל הסריקות: https://tigerbrandsglobal.com/apps/funnels/track?order=${encodeURIComponent(String(order.name).replace(/^#/, ""))}`,
    "",
    "אם משהו לא מסתדר, פשוט השיבי למייל הזה ואנחנו כאן.",
    "",
    "צוות Tiger Brands Global",
  ].join("\n");
}

export function delayText(order: any, status: ShipmentStatus | null, businessDays: number): string {
  const where = status ? describeForCustomer(status) : "החבילה נמצאת בדרך, ואנחנו בקשר עם חברת המשלוחים לקבלת סריקה עדכנית.";
  return [
    greet(firstName(order)),
    "",
    `רצינו לעדכן אותך בעצמנו על הזמנה ${order.name}${shadeLine(order)}, כי היא לוקחת יותר זמן ממה שהיינו רוצים (${businessDays} ימי עסקים).`,
    "",
    `המצב האמיתי נכון לעכשיו: ${where}`,
    "",
    "משלוחים מהמחסן לישראל עוברים מיון בהונג קונג, טיסה ומכס, ולפעמים אחד השלבים מתעכב. החבילה בדרך ולא אבדה, ואנחנו עוקבים אחריה עד שהיא אצלך.",
    "",
    `לצפייה בסריקות בזמן אמת: https://tigerbrandsglobal.com/apps/funnels/track?order=${encodeURIComponent(String(order.name).replace(/^#/, ""))}`,
    "",
    "אם יש שאלה, השיבי למייל הזה ונענה אישית.",
    "",
    "צוות Tiger Brands Global",
  ].join("\n");
}

export function giftText(order: any, status: ShipmentStatus | null, businessDays: number, code: string | null): string {
  const where = status ? describeForCustomer(status) : "החבילה עדיין בדרך, ואנחנו פתחנו פנייה מול חברת המשלוחים.";
  const gift = code
    ? [
        `בינתיים, כפיצוי על ההמתנה, הכנו לך קוד אישי ל-${GIFT_PERCENT}% הנחה על ההזמנה הבאה, תקף 60 יום:`,
        code,
        "",
      ]
    : [];
  return [
    greet(firstName(order)),
    "",
    `אנחנו מצטערים: הזמנה ${order.name}${shadeLine(order)} מתעכבת הרבה מעבר לרגיל (${businessDays} ימי עסקים), וזה לא מה שהבטחנו לך.`,
    "",
    `המצב האמיתי נכון לעכשיו: ${where}`,
    "",
    ...gift,
    "אם החבילה לא תגיע תוך ימים ספורים, נדאג לך לפתרון מלא, החלפה או החזר, בלי שתצטרכי לרדוף אחרינו. השיבי למייל הזה ואנחנו איתך.",
    "",
    "צוות Tiger Brands Global",
  ].join("\n");
}
