import type { SupportAgentFacts, SupportIntent } from "./contracts.js";

function orderLabel(facts: SupportAgentFacts): string {
  return facts.order?.orderName ? ` ${facts.order.orderName}` : "";
}

export function deterministicDraft(intent: SupportIntent, facts: SupportAgentFacts = {}, locale = "he"): string | null {
  if (intent === "thanks_no_reply" || intent === "legal_chargeback" || intent === "other") return null;

  const hebrew = !locale.toLowerCase().startsWith("en");
  const order = facts.order;

  if (hebrew) {
    switch (intent) {
      case "shipping_status":
        if (order?.found && order.trackingAvailable && order.trackingUrl) {
          return `היי, בדקתי את ההזמנה${orderLabel(facts)}. לפי נתוני המשלוח הקיימים יש מעקב פעיל: ${order.trackingUrl}`;
        }
        if (order?.found) {
          return `היי, בדקתי את ההזמנה${orderLabel(facts)}. כרגע אין לי נתון מעקב מאומת שאפשר לשלוח. אני מעביר/ה את הבדיקה להמשך טיפול בלי להמציא זמן מסירה.`;
        }
        return "היי, אשמח לבדוק. כדי לאתר את ההזמנה אני צריך/ה את מספר ההזמנה או את כתובת האימייל ששימשה ברכישה.";
      case "shipping_policy":
        return facts.knowledge?.shippingPolicyKnown
          ? "היי, אפשר לענות על זמני/תנאי המשלוח רק לפי מדיניות המשלוחים המאושרת של החנות. המערכת מצאה מקור מדיניות זמין לטיוטה."
          : "היי, אני רוצה לוודא שאני נותן/ת לך מידע מדויק. מדיניות המשלוחים המאושרת לא זמינה כרגע, ולכן אני מעביר/ה את השאלה לבדיקה במקום לנחש.";
      case "product_usage":
        return facts.knowledge?.productUsageKnown
          ? "היי, יש לי הוראות שימוש מאושרות למוצר ואני יכול/ה לנסח מהן תשובה מדויקת."
          : "היי, אני רוצה לתת לך הוראות שימוש מדויקות. כרגע אין למערכת מקור מוצר מאושר מספיק, ולכן אני מעביר/ה לבדיקה ולא מנחש/ת.";
      case "shade_recommendation":
      case "product_recommendation":
      case "product_question":
        return facts.knowledge?.productFactsKnown
          ? "היי, יש למערכת נתוני מוצר מאושרים וניתן לבנות מהם המלצה/תשובה בלי להמציא פרטים."
          : "היי, כדי להמליץ נכון אני צריך/ה להסתמך על נתוני המוצר המאושרים. כרגע חסר לי מקור כזה ולכן אני מעביר/ה לבדיקה.";
      case "stock_request":
        return facts.knowledge?.stockKnown
          ? "היי, זמינות המוצר נבדקה מול מקור מלאי מאושר וניתן לנסח ממנה תשובה."
          : "היי, אני לא רוצה להבטיח מלאי בלי בדיקה. כרגע אין לי נתון מלאי מאומת ולכן אני מעביר/ה לבדיקה.";
      case "discount_request":
        return "היי, בקשות להנחה נבדקות רק דרך מנגנון ההצעות המאושר של החנות. אני לא מייצר/ת קוד או אחוז הנחה בעצמי.";
      case "order_cancel":
        return `היי, קיבלתי את בקשת הביטול${orderLabel(facts)}. לפני כל שינוי בהזמנה צריך לבדוק את מצב המימוש ולקבל אישור. כרגע לא בוצע שום ביטול.`;
      case "address_change":
        return `היי, קיבלתי את בקשת שינוי הכתובת${orderLabel(facts)}. לפני שינוי בפועל צריך לאמת את ההזמנה, מצב המימוש והכתובת החדשה. כרגע לא בוצע שום שינוי.`;
      case "order_change":
        return `היי, קיבלתי את בקשת השינוי להזמנה${orderLabel(facts)}. השינוי עדיין לא בוצע והוא ממתין לבדיקה ואישור.`;
      case "return_request":
        return `היי, קיבלתי את בקשת ההחזרה${orderLabel(facts)}. צריך לבדוק את ההזמנה מול מדיניות ההחזרות המאושרת לפני פתיחת החזרה.`;
      case "refund_request":
        return `היי, קיבלתי את בקשת ההחזר${orderLabel(facts)}. לא בוצע החזר אוטומטי; הבקשה ממתינה לבדיקה ואישור לפי נתוני ההזמנה והמדיניות.`;
      case "refund_status":
        return order?.found
          ? `היי, מצאתי את ההזמנה${orderLabel(facts)}. סטטוס ההחזר חייב להישען על נתוני התשלום בפועל, בלי להבטיח מועד שלא מופיע במערכת.`
          : "היי, כדי לבדוק סטטוס החזר אני צריך/ה לאתר קודם את ההזמנה לפי מספר הזמנה או אימייל רכישה.";
      case "damaged_item":
      case "wrong_missing_item":
      case "delivery_issue":
        return `היי, קיבלתי את פרטי הבעיה${orderLabel(facts)}. המקרה דורש בדיקה לפני החלטה על החלפה, משלוח מחדש או החזר; כרגע לא בוצעה שום פעולה כספית או שינוי בהזמנה.`;
      default:
        return null;
    }
  }

  switch (intent) {
    case "shipping_status":
      if (order?.found && order.trackingAvailable && order.trackingUrl) return `I checked order${orderLabel(facts)}. Verified tracking is available here: ${order.trackingUrl}`;
      if (order?.found) return `I found order${orderLabel(facts)}, but there is no verified tracking link available yet. I won't invent a delivery promise.`;
      return "I can check this for you. Please send the order number or the email used for the purchase.";
    case "discount_request":
      return "Discounts are issued only through the store's authorized offer engine. I can't invent a coupon or discount percentage.";
    default:
      return "I can prepare a response from verified Shopify data, approved knowledge, and deterministic store rules. No customer-facing action has been taken.";
  }
}
