# September email plan

The app on this store is **Shopify Messaging**, not classic Shopify Email. It
lives at Apps → Messaging → Automations, and it sends Email, SMS and WhatsApp.

**There is no Admin API for it.** I checked all 470 mutations in the schema: it
exposes `segmentCreate`, `segmentUpdate` and `segmentDelete`, and the
`marketingActivity*` family, which is for apps reporting their own external
campaigns. Nothing composes or sends a message. So the audiences are built by
API and the campaigns are assembled in the admin against them.

I have not sent anything. Mass email to thousands of real people is not a thing
to trigger without you looking at it first.

---

## The real constraint

| | |
|---|---|
| allowance | 10,000 sends a month |
| subscribers | **2,663** |

That is **3.7 full sends**. The plan below uses 8,296 and leaves headroom. The
constraint is not volume, it is relevance: a send to everyone costs a quarter of
the month whether it earns anything or not.

Current Messaging performance, last 30 days: 22 sent, 4.75% click, **0 orders**.
Worth knowing before adding volume.

---

## Audiences (created, live in the admin)

| segment | size | why this group |
|---|---|---|
| ספטמבר 26 · כל המנויים | 2,663 | the launch. Everyone who agreed to hear from us |
| ספטמבר 26 · קנו בעבר ולא ב-90 יום | 2,131 | already trusted the store once. The catalogue is entirely new to them |
| ספטמבר 26 · מנויים שמעולם לא קנו | 515 | subscribed and stopped. A dated offer is a low-risk first purchase |
| ספטמבר 26 · לקוחות חוזרים | 324 | buy more than once. Different tone: first look, not a discount pitch |
| ספטמבר 26 · נטשו עגלה ב-30 יום | 6 | too small to send to on its own. Fold into another audience |
| nova hair buyers *(existed already)* | — | bought the colour product from the funnel |

One note: `products_purchased` is rejected by `segmentCreate` in API 2026-07,
so the NovaHair buyer segment could not be recreated by API. The store's
existing "nova hair buyers" segment already does the job, so use that one.

---

## The four sends

### 1 · Tue 16 Sep — the launch
**To:** כל המנויים (2,663)
**Subject:** `55 מוצרים חדשים בחנות, ומבצע חדש כל יום`
**Preview:** `היום יום הצבע. שלוש דרכים לכסות שיער לבן בבית.`

> שלום [שם],
>
> הוספנו לחנות 55 מוצרים חדשים לשיער ולעור, ורובם דברים שלא היו כאן קודם:
> שמפו צבע, מסכות, שמני קרקפת וסדרת טיפוח פנים חדשה.
>
> במקביל התחלנו שבועיים של מבצעים. כל יום מבצע אחר, עד חצות. יש ימים של מוצר
> אחד, ימים של נושא שלם וימים של שגרה מלאה במחיר אחד.
>
> היום זה **יום הצבע**: שלוש הדרכים לכסות שיער לבן בבית, כל אחת לסוג אחר של
> סבלנות. 25% על שלושתן.
>
> **[לראות את המבצע של היום]** → /pages/deals
>
> בערב יום כיפור ובמהלכו החנות שקטה ולא תקבלי מאיתנו שום דבר.

### 2 · Tue 22 Sep — after the fast
**To:** קנו בעבר ולא ב-90 יום (2,131)
**Subject:** `אחרי הצום, הקרקפת היא הראשונה שמרגישה`
**Preview:** `יום הקרקפת. 30% על הסרומים והמברשת.`

> שלום [שם],
>
> עברת אצלנו בעבר, ומאז החנות השתנתה כמעט לגמרי.
>
> היום **יום הקרקפת**, וזה לא מקרי. אחרי צום ויממה בלי לשתות כרגיל, הקרקפת
> היא בדרך כלל הדבר הראשון שמרגיש יבש.
>
> שלושה מוצרים ב-30%: סרום צמיחה לקו הפריקה, סרום ללא שטיפה לקרקפת יבשה,
> ומברשת הסיליקון שמפזרת אותם על העור במקום על השיער.
>
> **[לראות את המבצע של היום]** → /pages/deals

### 3 · Thu 25 Sep — erev Sukkot
**To:** מעולם לא קנו (515) + לקוחות חוזרים (324) = **839**
**Subject:** `הכלים שהופכים צביעה ביתית למסודרת`
**Preview:** `30% על ערכת הצביעה. היום בלבד.`

> שלום [שם],
>
> רוב הבלגן בצביעה ביתית לא מגיע מהצבע. הוא מגיע מכוס מהמטבח שנשפכת,
> וממברשת רחבה מדי שמורחת על המצח.
>
> היום 30% על ערכת הצביעה הביתית: קערה עם שוליים שמחזיקים, מברשת צרה לקו
> השורש, ומסרק הפרדה.
>
> **[לערכה]** → /products/novahair-coloring-kit
>
> מחר מתחיל סוכות. המבצעים ממשיכים כל חול המועד.

### 4 · Mon 29 Sep — the last days
**To:** כל המנויים (2,663)
**Subject:** `נשארו יומיים לשבועיים של טיפוח`
**Preview:** `היום שמן בטאנה. מחר הסט המלא לשיער פגום.`

> שלום [שם],
>
> שבועיים של מבצעים נגמרים ב-30 בספטמבר.
>
> היום **שמן בטאנה** ב-30%, הטיפול השבועי לשיער שעבר צביעה והחלקה.
> מחר, ליום האחרון, **הסט המלא**: שמפו קרטין, מסכת קרטין ושמן בטאנה יחד.
>
> **[ללוח המבצעים]** → /pages/deals

**Total: 8,296 of 10,000.**

---

## Rules for whoever sends these

- **Nothing goes out on 20 or 21 September.** Yom Kippur. Not a reduced send, not
  a "quiet" one. Nothing. The promotion page goes dark those days too.
- Send in the **morning, Israel time**, not the evening. These are read on a
  phone between other things.
- **One link per email.** Every one of these has a single destination.
- Subject lines: **no emoji, no ALL CAPS, no exclamation marks.** They read as
  spam in Hebrew and they are what the inbox filter looks at.
- The body copy above is final. It follows the same rules as the product pages:
  no em dash, female singular, nothing invented. Do not add a statistic, a
  review count or a countdown to make it feel stronger.

---

## Worth fixing before the next cycle

The abandoned-checkout automation is **Inactive** and has 22 sends, 2% click and
**0 orders** behind it. An abandoned-checkout flow is normally the single
highest-earning automation a store has. Turning it back on and pointing it at a
product page that now actually converts is likely worth more than all four
campaigns above put together.
