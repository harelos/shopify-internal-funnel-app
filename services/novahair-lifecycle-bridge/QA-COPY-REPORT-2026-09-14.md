# NovaHair Lifecycle — Copy QA Report (2026-09-14)

## מטרה
לוודא שהטקסט של כל כפתור בכל מייל תואם ליעד שאליו הכפתור באמת מוליך.

## מה נבדק
- 41 תבניות מיילים ב־6 flows
- 44 כפתורים ו־קישורים (מלבד unsubscribe)
- כל URL אומת שקיים באמת ב־tigerbrandsglobal.com

## תיקונים שבוצעו

| מייל | לפני | אחרי |
|------|------|------|
| `welcome E07` — "לבחור גוון" | הוליך ל־FAQ | הוליך ל־shade guide |
| `post_purchase E08` | כפתור "לכתוב חוות דעת" → contact (מטעה) | "לשתף אותנו בחוויה" → contact (תואם) |
| `abandoned_checkout E04` קישור משני | "לראות איך משתמשים" הוליך ל־checkout recovery | עכשיו הוליך לדף הוראות שימוש |
| `abandoned_checkout E08` קישור משני | "מדיניות משלוחים והחזרות" הוליך ל־checkout recovery | עכשיו הוליך ל־`/policies/shipping-policy` |

## שינויים טכניים
- הוסף `SECONDARY_CTA_URL` template variable ל־E04 ו־E08 של abandoned_checkout
- הוסף `secondaryLifecycleDestination()` ב־`lifecycle-links.ts`
- Dispatch מוסיף `payload.secondary_cta_url` עם UTM לכל מייל שדורש קישור משני
- Resend event schema של `shopify.checkout_abandoned` מקבל `secondary_cta_url: string`
- Automation blueprint מחבר את המשתנה לכל תבנית רלוונטית

## דפים שאומתו כקיימים ב־tigerbrandsglobal.com
- ✅ `/pages/novahair-sales-staging` (Sales)
- ✅ `/pages/novahair` (Product info)
- ✅ `/pages/novahair-shade-guide` (Shade guide)
- ✅ `/pages/novahair-faq` (FAQ)
- ✅ `/blogs/beauty-guide/novahair-instructions-how-to-use` (How-to)
- ✅ `/pages/contact` (Contact)
- ✅ `/apps/17TRACK` (Order tracking)
- ✅ `/policies/shipping-policy` (Shipping policy)
- ✅ `/policies/refund-policy` (Refund policy)
- ❌ `/pages/novahair-reviews` — לא קיים

## בעיות שנשארו (Flow כבוי)
`abandoned_cart` (מושבת בכוונה) — E02/E03/E04 עדיין עם כפתור "לחזור לעגלה" שמוליך לדפי shadeGuide/sales/faq במקום לעגלה. יש לתקן לפני שהזרימה הופעלה.

## הצעה למערכת ביקורות
כרגע post_purchase E08 מוליך לדף Contact — כי אין דף ביקורות אמיתי. אפשרויות:
1. **קצר טווח:** להשאיר כפי שהוא. הביקורות מגיעות למייל התמיכה, המוכיחות דורגות ידנית לפרסום.
2. **בינוני:** להוסיף שדה `reviews` באפליקציית Funnel Builder עם endpoint פשוט שקולט טופס, שולח אישור למייל התומך, ומפרסם בעמוד רק אחרי אישור.
3. **ארוך טווח:** להטמיע Judge.me / Loox / Yotpo (אפליקציה חיצונית) — עלות $15-$30 לחודש, אבל מקבל הכל: אימות, גלריית תמונות, שילוב ב־Google Shopping.

## מצב טסטים
- 56/56 טסטים עברו
- ✅ TypeScript build
- ✅ Worker bundle (299.6kb)
- ✅ 11 event definitions, 6 automations
