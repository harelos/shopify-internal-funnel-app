# A send every day to the end of September

Thirteen sends across the fifteen remaining days. Only Yom Kippur is dark.
Each day goes to its own audience, cut from two years of order history, and
each one rides the promotion day that matches what those people already own.

**7,878 emails of the 10,000 monthly allowance. Average send 606 people.**

---

## What two years of orders say

I pulled all **3,454 orders** (Sep 2024 to today) before writing anything.

**The store runs on four SKUs.** Thirteen products have ever been ordered:

| product | orders |
|---|---|
| מסיכת קולגן לילה אלסטיק־דרים | 1,418 |
| סרום חומצה היאלורונית 4 ב-1 | 1,021 |
| שמפו אמלה OCEAURA | 1,008 |
| שמן קיק שחור | 420 |
| NOVAHAIR ערכת צביעה | 145 |

**There are two customer bases and they barely overlap.**

- skincare: mask 1,018 · serum 558 · **both 546**
- hair: amla 749 · castor 273 · **both 241**
- bought from **both sides: 37 people**

Thirty-seven. That is the most useful number in the file, and it is what makes
a daily send possible: these are not one list, they are five or six small
lists that happen to share a checkout. It is also the biggest unworked
opportunity in the store, because 1,018 skincare buyers have never been offered
hair care and 749 hair buyers have never been offered skin care.

**The store nearly died and is restarting.** 528 orders in March 2025, 2 in
January 2026, nothing February to July, 28 in August, 68 in September so far.

**Recency is barbelled.** 94 orders in the last 30 days, **2** in days 31-90,
**0** in 91-180, **3,263** older than a year. There is no middle to work with.

**₪614,746 revenue, AOV ₪178, repeat rate 12%** (324 of 2,663 subscribers have
ordered twice). That last number is what the loyalty club is for.

---

## The delivery question

**The store records no delivery confirmations at all.** Of 82 parcels shipped in
the last 60 days, not one has a `deliveredAt` and not one has an ETA. Nothing
feeds tracking back into Shopify, so "has it arrived" cannot be asked.

So: **no promotion to anyone who might still be waiting**, using time as the
proxy. CJ to Israel runs 8 to 20 days, so every promotional audience below
carries

```
(number_of_orders = 0 OR last_order_date < -14d)
```

It removes 11 people. Small, and right: a discount email to someone still
waiting on a parcel is the fastest way to turn a customer into a complaint.

They get `שוטף · ממתינות למשלוח` instead, which is a shipping update and
nothing else, and which says plainly that we held the promotions back.

**Two things to fix separately.** Four orders are 9 to 24 days old and still
unshipped. And with no delivery tracking there can be no "how is it?" email,
which is normally where a beauty store earns its second order.

---

## The schedule

| date | day | time | audience | size | rides |
|---|---|---|---|---|---|
| 16.9 | רביעי | 09:00 | קוני אמלה בלבד | 508 | יום הצבע |
| 17.9 | חמישי | 09:00 | קוני שמן קיק | 273 | שמן ארגן |
| 18.9 | שישי | 08:30 | לקוחות חוזרים | 321 | שגרת החפיפה |
| 19.9 | מוצ״ש | 20:30 | רדומות ≤180, שנה עד שנה וחצי | 155 | שמפו יומיומי |
| **20-21.9** | | | **יום כיפור. שום דבר לא יוצא** | **0** | dark |
| 22.9 | שלישי | 09:00 | מנויות שמעולם לא קנו | 515 | יום הקרקפת |
| 23.9 | רביעי | 09:00 | רדומות ≤180, מעל שנה וחצי | 739 | קרם צבע עם מסרק |
| 24.9 | חמישי | 09:00 | רדומות 180-260 | 814 | ערכת הצביעה המלאה |
| 25.9 | שישי | 08:30 | רדומות מעל 260 | 368 | ערכת צביעה |
| 26.9 | מוצ״ש | 20:30 | קוני אמלה וגם קיק | 241 | יום השמנים |
| 27.9 | ראשון | 09:00 | קוני מסכה וגם סרום | 546 | פילינג גוף |
| 28.9 | שני | 09:00 | קוני מסכה בלבד | 472 | יום הפנים |
| 29.9 | שלישי | 09:00 | הוציאו מעל ₪300 | 274 | שמן בטאנה |
| 30.9 | רביעי | 09:00 | הזדמנות אחרונה, כל המנויות | 2,652 | הסט לשיער פגום |

**On the two Saturdays.** 19.9 and 26.9 are Shabbat. Both go out **motzei
Shabbat at 20:30**, which is when an Israeli list is actually read, and 26.9 is
also motzei chag of the first day of Sukkot. Friday sends go at 08:30, early
enough to be read before the day closes down.

**On Yom Kippur.** Nothing. Not a reduced send, not a quiet one, not the service
email. This is the one day where the right number of emails is zero.

---

## Segments

**Nine exist by API.** Five must be pasted in by hand: `segmentCreate` refuses
any query containing `products_purchased MATCHES`, even though the query engine
behind `customerSegmentMembers` accepts the identical string and returns a
count. A genuine inconsistency in the Shopify API, not a permissions problem.

Customers → Segments → Create segment:

```
ספט · קוני אמלה בלבד
email_subscription_status = 'SUBSCRIBED' AND (number_of_orders = 0 OR last_order_date < -14d) AND products_purchased MATCHES (id = 9566713905447) AND NOT products_purchased MATCHES (id = 9608345944359)

ספט · קוני שמן קיק
email_subscription_status = 'SUBSCRIBED' AND (number_of_orders = 0 OR last_order_date < -14d) AND products_purchased MATCHES (id = 9608345944359)

ספט · קוני אמלה וגם קיק
email_subscription_status = 'SUBSCRIBED' AND (number_of_orders = 0 OR last_order_date < -14d) AND products_purchased MATCHES (id = 9566713905447) AND products_purchased MATCHES (id = 9608345944359)

ספט · קוני מסכה וגם סרום
email_subscription_status = 'SUBSCRIBED' AND (number_of_orders = 0 OR last_order_date < -14d) AND products_purchased MATCHES (id = 9671746683175) AND products_purchased MATCHES (id = 9695478677799)

ספט · קוני מסכה בלבד
email_subscription_status = 'SUBSCRIBED' AND (number_of_orders = 0 OR last_order_date < -14d) AND products_purchased MATCHES (id = 9671746683175) AND NOT products_purchased MATCHES (id = 9695478677799)
```

The app also has **no protected-customer-data approval**, so it cannot read a
single customer name, email or address. Everything here was built from
order-level data and segment counts.

---

## The copy

No em dash, female singular, nothing invented, one link each, no emoji in
subject lines.

### 16.9 · קוני אמלה בלבד (508) · יום הצבע
**נושא:** `קנית אצלנו שמפו. מאז נוספו 55 מוצרים`
**תצוגה:** `היום יום הצבע, שלוש דרכים לכסות שיער לבן בבית.`

> שלום [שם],
>
> קנית אצלנו שמפו אמלה, ומאז לא היה לנו הרבה להציע לך. זה השתנה.
> הוספנו 55 מוצרים חדשים: שמפו צבע, מסכות, שמני קרקפת ואביזרים.
>
> היום **יום הצבע**, שלוש הדרכים לכסות שיער לבן בבית, כל אחת לסוג אחר
> של סבלנות. 25% על שלושתן, היום בלבד.
>
> **[לראות את המבצע של היום]**

### 17.9 · קוני שמן קיק (273) · שמן ארגן
**נושא:** `שמן ארגן, לקצוות שספגו את כל הצביעות`
**תצוגה:** `25% היום בלבד.`

> שלום [שם],
>
> קנית אצלנו שמן קיק, אז את כבר יודעת מה שמן טוב עושה לשיער.
>
> **שמן ארגן** עובד אחרת: קל יותר, נמרח על שיער לח לפני הייבוש,
> ומיועד לקצוות ולא לקרקפת. שלוש טיפות, רק מאמצע ומטה.
>
> היום ב-25%.
>
> **[לשמן הארגן]**

### 18.9 · לקוחות חוזרים (321) · שגרת החפיפה
**נושא:** `שמפו, מסכה ושמן. שלושת השלבים במחיר אחד`
**תצוגה:** `30% על השגרה המלאה, היום בלבד.`

> שלום [שם],
>
> קנית אצלנו יותר מפעם אחת, וזה אומר שאת כבר עובדת בשגרה
> ולא במוצרים בודדים.
>
> היום בנינו בדיוק את זה: שמפו צמחי לקרקפת, מסכה היאלורונית לאורך,
> ושמן ארגן לקצוות. שלושתם ב-30%.
>
> **[לשגרה המלאה]**

### 19.9 · רדומות ≤180, שנה עד שנה וחצי (155) · שמפו יומיומי
**נושא:** `השמפו לימים שבהם החפיפה רק צריכה לנקות`
**תצוגה:** `25% עד חצות.`

> שלום [שם],
>
> עבר קצת יותר משנה מאז שקנית אצלנו. בינתיים החלפנו כמעט את כל הקטלוג.
>
> לא כל חפיפה צריכה להיות טיפול. רוב החפיפות רק צריכות לנקות היטב
> ולא להוריד את הגוון. זה השמפו לימים האלה, היום ב-25%.
>
> **[לשמפו]**

### 22.9 · מנויות שמעולם לא קנו (515) · יום הקרקפת
**נושא:** `אחרי הצום, הקרקפת היא הראשונה שמרגישה`
**תצוגה:** `שלושה מוצרי קרקפת ב-30%.`

> שלום [שם],
>
> את רשומה אצלנו ועוד לא קנית. זו הזדמנות טובה להתחיל בקטן.
>
> היום **יום הקרקפת**, ולא במקרה. אחרי צום ויממה בלי לשתות כרגיל,
> הקרקפת היא בדרך כלל הדבר הראשון שמרגיש יבש.
>
> שלושה מוצרים ב-30%: סרום לקו הפריקה, סרום ללא שטיפה לקרקפת יבשה,
> ומברשת הסיליקון שמפזרת אותם על העור במקום על השיער.
>
> **[לראות את המבצע של היום]**

### 23.9 · רדומות ≤180, מעל שנה וחצי (739) · קרם צבע עם מסרק
**נושא:** `עבר יותר משנה וחצי. החנות נראית אחרת`
**תצוגה:** `קרם צבע עם מסרק מובנה, 25% היום.`

> שלום [שם],
>
> קנית אצלנו פעם, ומאז עבר הרבה זמן. בינתיים החלפנו כמעט את כל הקטלוג.
>
> היום **קרם צבע עם מסרק מובנה**. המסרק מחובר לשפופרת, הקרם יוצא דרך
> השיניים, ואת מעבירה אותו על קו השורש כמו שאת מסרקת.
> בלי קערה, בלי מברשת, בלי כפפות.
>
> 25% היום בלבד.
>
> **[לקרם הצבע]**

### 24.9 · רדומות 180-260 (814) · ערכת הצביעה המלאה
**נושא:** `הצבע, הכלים והשמפו שישמור עליו`
**תצוגה:** `הערכה המלאה ב-30%, היום בלבד.`

> שלום [שם],
>
> עבר זמן. אם את עדיין צובעת שורשים בבית, זה היום להצטייד.
>
> **הערכה המלאה** ב-30%: קרם הצבע עם המסרק, ערכת הכלים שמונעת את
> הבלגן על הכיור, והשמפו הצמחי שמאריך את חיי הגוון בין צביעה לצביעה.
>
> **[לערכה המלאה]**

### 25.9 · רדומות מעל 260 (368) · ערכת צביעה
**נושא:** `רוב הבלגן בצביעה לא מגיע מהצבע`
**תצוגה:** `ערכת הכלים ב-30%, לפני החג.`

> שלום [שם],
>
> רוב הבלגן בצביעה ביתית מגיע מכוס מהמטבח שנשפכת, וממברשת רחבה מדי
> שמורחת על המצח. בסוף יש יותר צבע על הכיור מאשר על השורש.
>
> **ערכת הצביעה** היא שלושת הכלים שבאמת עושים את העבודה: קערה עם
> שוליים שמחזיקים, מברשת צרה לקו השורש, ומסרק להפרדת פסים.
>
> היום ב-30%. חג שמח.
>
> **[לערכה]**

### 26.9 · קוני אמלה וגם קיק (241) · יום השמנים
**נושא:** `שלושה שמנים, שלוש עבודות שונות`
**תצוגה:** `קרקפת, אורך וקצוות. 25% על שלושתם.`

> שלום [שם],
>
> קנית אצלנו גם שמפו וגם שמן, אז את כבר עובדת בשיטה.
>
> היום **יום השמנים**, ושלושתם עושים דברים שונים:
> רוזמרין לקרקפת לפני החפיפה, בטאנה לאורך כטיפול שבועי,
> וקוקוס כמסכה לשיער מתפרע.
>
> 25% על שלושתם.
>
> **[ליום השמנים]**

### 27.9 · קוני מסכה וגם סרום (546) · פילינג גוף
**נושא:** `הרחבנו את הטיפוח מהפנים לגוף`
**תצוגה:** `פילינג גוף מאצ'ה, 30% היום.`

> שלום [שם],
>
> קנית אצלנו גם מסכה וגם סרום, אז את מכירה את הקו לפנים.
> הוספנו שורה חדשה לגוף.
>
> היום **פילינג גוף מאצ'ה** ב-30%. טיפ אחד משנה את התוצאה:
> סוגרים את המים ומעסים על עור לח, לא מתחת לזרם.
> מים זורמים מדללים את הגרגרים לפני שהספיקו לעשות משהו.
>
> **[לפילינג]**

### 28.9 · קוני מסכה בלבד (472) · יום הפנים
**נושא:** `קנית מסכה. מעולם לא ניסית סרום`
**תצוגה:** `שלושה סרומים, שלוש בעיות. 25% היום.`

> שלום [שם],
>
> קנית אצלנו מסכת לילה ומעולם לא ניסית סרום. ההבדל ביניהם פשוט:
> מסכה עובדת בלילה, סרום עובד כל יום.
>
> היום **יום הפנים**, שלושת הסרומים של NovaGlow ב-25%:
> PDRN ללחות ולעור עייף, פפטידי נחושת למרקם,
> וחומצה אזלאית לאדמומיות ולכתמים שנשארים אחרי פצעונים.
>
> **[ליום הפנים]**

### 29.9 · הוציאו מעל ₪300 (274) · שמן בטאנה
**נושא:** `שמן בטאנה, לשיער שכבר עבר יותר מדי`
**תצוגה:** `30% היום בלבד.`

> שלום [שם],
>
> יש שיער שכבר אי אפשר לטפל בו עם מוצר יומי. הוא עבר צביעה, החלקה,
> ועוד צביעה, והוא מרגיש קשיח למגע כבר בשורש.
>
> **שמן בטאנה** הוא טיפול שבועי ולא מוצר גימור. מחממים בין הידיים,
> מורחים מאמצע ומטה, שעה עם מגבת, ואז חפיפה כפולה.
>
> היום ב-30%.
>
> **[לשמן בטאנה]**

### 30.9 · הזדמנות אחרונה (2,652) · הסט לשיער פגום
**נושא:** `היום האחרון של שבועיים של טיפוח`
**תצוגה:** `הסט המלא לשיער פגום, 30%.`

> שלום [שם],
>
> שבועיים של מבצעים נגמרים היום בחצות.
>
> לסיום, **הסט לשיער שעבר יותר מדי**: שמפו קרטין, מסכת קרטין
> ושמן בטאנה. שלושתם ב-30%.
>
> **[ללוח המבצעים]**

### שוטף · ממתינות למשלוח (11) — not a promotion
**נושא:** `ההזמנה שלך בדרך`

> שלום [שם],
>
> ההזמנה שלך יצאה. זמן האספקה הרגיל הוא 8 עד 20 ימי עסקים.
>
> אם עברו יותר מ-20 יום ועוד לא הגיע, כתבי לנו ונבדוק.
>
> לא שלחנו לך מבצעים השבוע בכוונה. נחזור אחרי שההזמנה תגיע.

---

## Rules

- **20 and 21 September: nothing.**
- Weekday sends 09:00, Friday 08:30, Saturday 20:30 motzei Shabbat.
- One link per email. Every one above has exactly one.
- No emoji, no capitals, no exclamation marks in subject lines.
- Do not add a review count, a statistic or a countdown.

---

## The one thing worth more than all thirteen

The abandoned-checkout automation is **Inactive**, with 22 sends and **0 orders**
behind it. That flow is normally the highest-earning automation a store has, and
it now has a product page that converts to point at. Turning it on costs nothing.
