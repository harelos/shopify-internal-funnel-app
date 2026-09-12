# NovaHair Lifecycle V2 — complete proposed copy bank

Status: copy proposal for review and disabled template creation. Do not replace live templates until factual, visual, link and trigger QA is complete.

Voice: Israeli Hebrew, feminine singular, direct and warm, without forced slang, exaggerated promises or invented urgency.

## Shared rules

- Brand signature: `NovaHair by TigerBrandsGlobal`.
- Support: replying to the email is always a valid path.
- Approved delivery wording: `המשלוח לישראל מגיע בדרך כלל בתוך 5–14 ימי עסקים ממועד ההזמנה, לרוב לנקודת איסוף.`
- Tracking wording: `מספר המעקב יכול להופיע אחרי שההזמנה כבר בטיפול.` Never promise an immediate tracking number.
- Usage wording: `ברוב המקרים השימוש אורך בערך 10–15 דקות; פועלים לפי ההוראות שמצורפות למוצר.`
- Approved product facts from the current sales page: five shades, shades may be mixed, ammonia-free, intended to cover white hair, 60-day guarantee subject to the published policy, bundles of 2/4/6, full dye kit included. Revalidate these at publish time.
- Commercial email footer includes the Resend unsubscribe link. Pure operational service email contains no offer, cross-sell or marketing block.
- Every proof slot must use a real, merchant-owned asset. Never publish the placeholder itself.
- Every destination is explicit: `CHECKOUT_URL`, `PRODUCT_URL`, `SHADE_GUIDE_URL`, `HOW_TO_URL`, `REVIEWS_URL`, `POLICY_URL`, `ORDER_STATUS_URL`, `TRACKING_URL`, `SUPPORT_URL`, `REVIEW_URL`, or a signed response URL. Do not reuse one generic CTA URL.

---

# A. Abandoned Checkout — 10 emails

Stop on exact checkout recovery or purchase. Also stop on unsubscribe, complaint, hard bounce or open service case.

## AC01 — restore the checkout

- Timing: 60 minutes after a qualified abandoned checkout.
- Subject: `נשאר רק להשלים את ההזמנה`
- Preview: `החבילה והגוון שבחרת עדיין שמורים בקישור הזה.`
- CTA: `לחזרה להזמנה` → `CHECKOUT_URL`

היי {{first_name}},

נראה שהגעת כמעט עד הסוף עם ההזמנה של NovaHair, אבל התשלום לא הושלם.

החבילה והגוון שבחרת עדיין מחכים לך, ואפשר לחזור בדיוק לנקודה שבה עצרת.

[כפתור: לחזרה להזמנה]

אם משהו נתקע בדרך — תשלום, גוון, משלוח או שאלה אחרת — פשוט עני למייל הזה ונעזור.

## AC02 — identify the real blocker

- Timing: 6 hours after abandonment.
- Subject: `מה עצר אותך רגע לפני התשלום?`
- Preview: `בחרי תשובה אחת ונראה לך רק את מה שרלוונטי.`
- CTA: four signed response links.

היי {{first_name}},

לפעמים חסר רק פרט אחד כדי להחליט. מה הכי העסיק אותך?

- [לא בטוחה לגבי הגוון] → `BLOCKER_SHADE_URL`
- [רוצה להבין את הכיסוי] → `BLOCKER_COVERAGE_URL`
- [יש לי שאלה על המשלוח] → `BLOCKER_SHIPPING_URL`
- [מתלבטת לגבי המחיר או החבילה] → `BLOCKER_PRICE_URL`

הבחירה שלך תפתח תשובה קצרה ומדויקת. אם נוח לך יותר, אפשר פשוט לענות למייל.

## AC03 — white-hair proof

- Timing: 24 hours after abandonment, unless the blocker branch already answered this objection.
- Subject: `איך נראה הכיסוי על שיער לבן?`
- Preview: `לא הבטחה כללית—תוצאה אמיתית והסבר למה משפיע עליה.`
- CTA: `לראות תוצאות נוספות` → `REVIEWS_URL`

היי {{first_name}},

NovaHair מיועד לכיסוי שיער לבן, בעיקר באזור השורשים. התוצאה בפועל תלויה בבסיס השיער, בגוון שבוחרים ובמריחה אחידה לפי ההוראות.

[בלוק הוכחה: תמונת לפני/אחרי מאושרת, עם הגוון שבו נעשה שימוש וללא עריכה מטעה]

אם את בין שני גוונים, אפשר לענות לנו עם תמונה באור טבעי ונעזור לכוון.

[כפתור: לראות תוצאות נוספות]

## AC04 — how it works

- Timing: Day 2.
- Subject: `איך משתמשים ב‑NovaHair בפועל?`
- Preview: `כמה צעדים פשוטים, עם דגש על השורשים.`
- CTA: `למדריך השימוש` → `HOW_TO_URL`

היי {{first_name}},

השימוש הביתי לא דורש ניסיון קודם. מורחים היטב על השורשים והשיער הלבן—עם כפפות, מברשת או בתנועות שמזכירות חפיפה—וממשיכים לפי ההוראות שמצורפות למוצר.

ברוב המקרים התהליך אורך בערך 10–15 דקות, ואז שוטפים היטב.

אפשר למרוח גם על שאר השיער כשצריך, אבל הדגש הוא על האזורים שבהם רואים את הצמיחה הלבנה.

[כפתור: למדריך השימוש]

## AC05 — bundle value

- Timing: Day 3.
- Subject: `איזו חבילה באמת מתאימה לקצב שלך?`
- Preview: `לא תמיד צריך את החבילה הגדולה—הנה דרך פשוטה לבחור.`
- CTA: `לראות את החבילות` → `PRODUCT_URL`

היי {{first_name}},

הבחירה בין 2, 4 או 6 בקבוקים תלויה בעיקר בתדירות השימוש ובכמה זמן את רוצה להיות מסודרת מראש.

{{dynamic_bundle_comparison}}

אפשר גם לשלב גוונים שונים באותה חבילה. המחיר והחיסכון שמופיעים בקישור הם המחירים העדכניים.

[כפתור: לראות את החבילות]

## AC06 — concise FAQ

- Timing: Day 4.
- Subject: `5 תשובות קצרות לפני שמזמינים`
- Preview: `גוון, שיער לבן, זמן שימוש, משלוח ומה קורה אם לא מסתדר.`
- CTA: `לשאלות ולתשובות` → `PRODUCT_URL#faq`

היי {{first_name}},

**יש חמישה גוונים?** כן, ואפשר לשלב גוונים בחבילה.

**זה מיועד לשיער לבן?** כן. חשוב לבחור גוון מתאים ולכסות היטב את האזור.

**כמה זמן זה לוקח?** ברוב המקרים בערך 10–15 דקות, לפי ההוראות.

**מתי המשלוח מגיע?** בדרך כלל בתוך 5–14 ימי עסקים ממועד ההזמנה.

**ואם אני צריכה עזרה?** פשוט עני למייל. תנאי האחריות המלאים נמצאים במדיניות שבאתר.

[כפתור: לשאלות ולתשובות]

## AC07 — verified customer proof

- Timing: Day 5.
- Subject: `לפעמים עדיף פשוט לראות`
- Preview: `תוצאות אמיתיות, בלי לבקש ממך לדמיין.`
- CTA: `לראות עוד תוצאות` → `REVIEWS_URL`

היי {{first_name}},

כשמדובר בצבע לשיער, הסבר טוב לא מחליף תמונה אמיתית.

[גלריה: 2–3 תוצאות מאושרות בלבד, עם גוון ובסיס שיער כשידוע]

התוצאה לא זהה אצל כולן, ולכן כדאי להסתכל על מקרים שקרובים לבסיס השיער שלך.

[כפתור: לראות עוד תוצאות]

## AC08 — trust and policy

- Timing: Day 7.
- Subject: `ואם משהו לא מסתדר?`
- Preview: `יש עם מי לדבר, ויש מדיניות ברורה.`
- CTA: `לקריאת המדיניות` → `POLICY_URL`

היי {{first_name}},

גם אחרי שקוראים הכול, טבעי לרצות לדעת מה קורה אם הגוון לא מרגיש נכון או אם צריך עזרה בשימוש.

אפשר לענות למייל הזה ולקבל עזרה מצוות NovaHair. באתר מפורסמת גם אחריות ל‑60 יום, בכפוף לתנאים המלאים.

[כפתור: לקריאת המדיניות]

## AC09 — human help

- Timing: Day 10.
- Subject: `רוצה שנעזור לך להחליט?`
- Preview: `אפשר לענות במילה אחת: גוון, שימוש, משלוח או חבילה.`
- CTA: reply.

היי {{first_name}},

אם NovaHair עדיין מעניין אותך אבל נשארה שאלה, עני למייל במילה אחת: **גוון**, **שימוש**, **משלוח** או **חבילה**.

נחזור אלייך עם תשובה ממוקדת. לא צריך למלא טופס ולא להתחיל שיחה מחדש.

## AC10 — close reminders

- Timing: Day 14.
- Subject: `נסגור את התזכורות על ההזמנה הזו?`
- Preview: `זה המייל האחרון לגבי הצ׳קאאוט שנשאר פתוח.`
- CTA: `לחזרה אחרונה להזמנה` → `CHECKOUT_URL`

היי {{first_name}},

זה המייל האחרון שנשלח לגבי ההזמנה שנשארה פתוחה.

אם היא עדיין רלוונטית, אפשר לחזור אליה דרך הקישור. אם לא—לא צריך לעשות כלום, ולא נמשיך להזכיר את הצ׳קאאוט הזה.

[כפתור: לחזרה אחרונה להזמנה]

---

# B. Welcome — 10 emails

Only for a known eligible subscriber. Stop the first-purchase sales sequence on Cart, Checkout or Purchase.

## W01 — welcome and self-selection

- Timing: immediately.
- Subject: `ברוכה הבאה ל‑NovaHair`
- Preview: `נתחיל מהדבר שהכי חשוב לך עכשיו.`
- CTA: signed preference links.

היי {{first_name}},

ברוכה הבאה ל‑NovaHair by TigerBrandsGlobal.

כדי שלא נשלח לך סתם מידע, מה הכי חשוב לך עכשיו?

- [לכסות שיער לבן]
- [לבחור גוון]
- [להבין איך משתמשים]
- [לבדוק חבילות ומחירים]

אפשר לבחור תשובה אחת, ואפשר גם פשוט לענות למייל.

## W02 — the use case

- Timing: Day 1.
- Subject: `כשהשורשים חוזרים לפני שמתאים לך לקבוע תור`
- Preview: `NovaHair נועד לתת לך אפשרות נוספת בבית.`
- CTA: `להכיר את NovaHair` → `PRODUCT_URL`

השורשים לא תמיד מחכים לזמן שמתאים לך להגיע למספרה.

NovaHair נועד לכיסוי ביתי של שיער לבן, עם דגש על אזור השורשים, כדי שתוכלי לטפל במה שמפריע לך בזמן שנוח לך.

זו לא הבטחה לוותר על מספרה לתמיד. זו אפשרות להיות פחות תלויה בתור בכל פעם שרואים שוב צמיחה.

[כפתור: להכיר את NovaHair]

## W03 — usage demonstration

- Timing: Day 2.
- Subject: `כך נראה שימוש של 10–15 דקות`
- Preview: `בלי ניסיון קודם ועם כמה דרכי מריחה.`
- CTA: `לראות את ההדגמה` → `HOW_TO_URL`

מרטיבים או מכינים את השיער לפי ההוראות, מורחים היטב על השורשים והשיער הלבן, ממתינים לפי ההוראות ושוטפים.

אפשר להשתמש בכפפות, במברשת או בתנועות שמזכירות חפיפה—מה שנוח לך ועוזר להגיע לכיסוי אחיד.

[בלוק וידאו/תמונות: הדגמה אמיתית מאושרת]

[כפתור: לראות את ההדגמה]

## W04 — proof with context

- Timing: Day 3.
- Subject: `מה כדאי לבדוק בתמונת לפני ואחרי?`
- Preview: `לא רק את הצבע—גם את בסיס השיער והגוון שנבחר.`
- CTA: `לראות תוצאות` → `REVIEWS_URL`

לפני ואחרי יכול לעזור רק כשמבינים מה רואים.

חפשי תוצאה עם בסיס שיער שדומה לשלך, בדקי איזה גוון נבחר והסתכלי במיוחד על אזור השורשים.

[בלוק הוכחה מאושר עם הקשר]

[כפתור: לראות תוצאות]

## W05 — shade guide

- Timing: Day 5.
- Subject: `אל תבחרי גוון רק לפי השם שלו`
- Preview: `הבסיס שלך חשוב יותר מהשם שעל האריזה.`
- CTA: `למדריך הגוונים` → `SHADE_GUIDE_URL`

כשבוחרים גוון, כדאי להתחיל מהצבע שקיים עכשיו בשורשים ומהתוצאה שרוצים לקבל.

אם את בין שני גוונים, אפשר לשלב גוונים שונים בחבילה או לענות לנו עם תמונה באור טבעי וננסה לכוון.

[כפתור: למדריך הגוונים]

## W06 — bundle economics

- Timing: Day 7.
- Subject: `2, 4 או 6—איך לבחור בלי להגזים?`
- Preview: `לפי קצב השימוש שלך, לא לפי החבילה הכי גדולה.`
- CTA: `להשוות חבילות` → `PRODUCT_URL#bundles`

אם את רוצה לנסות ולהכיר את השימוש, חבילה קטנה יכולה להספיק להתחלה. אם כבר ברור לך שתרצי לטפל בשורשים לאורך זמן, חבילה גדולה יותר יכולה להוריד את המחיר לבקבוק.

{{dynamic_bundle_comparison}}

אפשר לשלב גוונים. בדקי בקישור את המחיר העדכני לפני הבחירה.

[כפתור: להשוות חבילות]

## W07 — white-hair coverage

- Timing: Day 9.
- Subject: `כן, המטרה היא לכסות שיער לבן`
- Preview: `והמריחה הנכונה עדיין משנה את התוצאה.`
- CTA: `לראות איך מורחים בשורשים` → `HOW_TO_URL`

NovaHair מיועד לכיסוי שיער לבן. כדי לקבל כיסוי אחיד, חשוב לבחור גוון מתאים, לעבוד על אזור השורשים בסבלנות ולתת למוצר את הזמן שמופיע בהוראות.

אין צורך בניסיון קודם, אבל הדגמה קצרה לפני הפעם הראשונה יכולה לחסוך טעויות.

[כפתור: לראות איך מורחים בשורשים]

## W08 — prevent first-use mistakes

- Timing: Day 12.
- Subject: `5 טעויות שקל למנוע לפני השימוש הראשון`
- Preview: `בחירת גוון, כמות, כיסוי, זמן ושטיפה.`
- CTA: `לשמור את המדריך` → `HOW_TO_URL`

1. לבחור לפי שם הגוון בלבד.
2. למרוח מעט מדי באזור הלבן.
3. לדלג על בדיקת ההוראות לפני שמתחילים.
4. לשטוף לפני הזמן שמצוין.
5. להתחיל בלי להכין כפפות, מברשת או מגבת.

שמרי את המדריך גם אם את עדיין רק בודקת.

[כפתור: לשמור את המדריך]

## W09 — verified story

- Timing: Day 16.
- Subject: `למה היא חיפשה פתרון לשורשים בבית?`
- Preview: `סיפור אמיתי אחד, בלי להפוך אותו להבטחה לכולן.`
- CTA: `לקרוא ולראות את התוצאה` → `REVIEWS_URL`

[סיפור לקוחה מאושר בלבד: המצב לפני, למה בחרה, הגוון, איך השתמשה ומה קרה בפועל. לכלול אישור שימוש בתוכן.]

החוויה שלה לא מבטיחה תוצאה זהה לכל אחת, אבל היא יכולה לעזור להבין אם השימוש מתאים גם לך.

[כפתור: לקרוא ולראות את התוצאה]

## W10 — final decision map

- Timing: Day 21.
- Subject: `אם עדיין לא החלטת—הנה הדרך הקצרה`
- Preview: `בחרי את השאלה שנשארה, או סגרי את סדרת ההיכרות.`
- CTA: blocker links and `PRODUCT_URL`.

אם קראת עד כאן ועדיין לא החלטת, כנראה שנשארה שאלה מסוימת — לא שחסר לך עוד נאום מכירה.

- [אני צריכה עזרה בגוון]
- [אני רוצה לראות תוצאות]
- [אני רוצה להבין משלוח ואחריות]
- [אני רוצה להשוות חבילות]

אפשר גם לענות למייל. זה המייל האחרון בסדרת ההיכרות הזו.

---

# C. Abandoned Cart — 5 emails

Requires a matched known identity and real cart. Stop on Checkout or Purchase.

## CART01

- Timing: 2 hours after last cart activity.
- Subject: `השארת משהו בעגלה`
- Preview: `{{product_name}}, {{variant}}, {{bundle}}—הנה הדרך לחזור.`
- CTA: `לחזרה לעגלה` → `CART_URL`

היי {{first_name}},

השארת בעגלה את {{product_name}} בגוון {{variant}} ובחבילת {{bundle}}.

אם פשוט יצאת באמצע, אפשר לחזור מכאן. אם משהו בבחירה לא מרגיש נכון, עני למייל ונבדוק יחד.

[כפתור: לחזרה לעגלה]

## CART02

- Timing: 12 hours after cart abandonment.
- Subject: `רוצה לבדוק שוב את הגוון לפני התשלום?`
- Preview: `עדיף לבדוק עכשיו מאשר לבחור מתוך ניחוש.`
- CTA: `למדריך הגוונים` → `SHADE_GUIDE_URL`

הגוון בעגלה שלך הוא {{variant}}.

אם הוא מתאים לבסיס השיער ולתוצאה שאת רוצה, אפשר להמשיך. אם את בין שני גוונים, אפשר לענות עם תמונה באור טבעי או לבדוק את המדריך.

[כפתור: למדריך הגוונים]

## CART03

- Timing: Day 2.
- Subject: `לפני שממשיכים—כך זה נראה בפועל`
- Preview: `תוצאה אמיתית שקרובה ככל האפשר לבחירה שלך.`
- CTA: `לראות תוצאות` → `REVIEWS_URL`

[בלוק הוכחה דינמי ומאושר לפי גוון, אם קיים. אם אין התאמה אמינה—להציג גלריה כללית ולא לטעון שזו אותה בחירה.]

התוצאה תלויה בבסיס השיער ובשימוש, לכן אנחנו מעדיפים להראות הקשר ולא רק תמונה יפה.

[כפתור: לראות תוצאות]

## CART04

- Timing: Day 4.
- Subject: `אולי זו השאלה שעצרה אותך`
- Preview: `שימוש, משלוח, אחריות או חבילה.`
- CTA: signed blocker links.

מה תרצי לבדוק לפני שממשיכים?

- [איך משתמשים]
- [מתי המשלוח מגיע]
- [מה כוללת האחריות]
- [איזו חבילה מתאימה לי]

בחרי תשובה ונראה לך רק את המידע הרלוונטי.

## CART05

- Timing: Day 7.
- Subject: `להשאיר את העגלה פתוחה או לסגור את התזכורות?`
- Preview: `זה המייל האחרון לגבי העגלה הזו.`
- CTA: `לחזרה לעגלה` → `CART_URL`

אם הבחירה עדיין רלוונטית, העגלה מחכה בקישור. אם לא, לא צריך לעשות דבר—לא נמשיך להזכיר אותה.

[כפתור: לחזרה לעגלה]

---

# D. Browse Abandonment — 3 emails

Known, eligible identity only; no Cart/Checkout/Purchase; maximum one Browse sequence per 14 days.

## BR01

- Timing: 4 hours after qualified browsing.
- Subject: `רוצה עזרה לבחור גוון?`
- Preview: `הסתכלת על NovaHair—הנה הצעד השימושי הבא.`
- CTA: `למדריך הגוונים` → `SHADE_GUIDE_URL`

ראינו שהתעניינת ב‑NovaHair. אם השאלה הראשונה שלך היא הגוון, התחילי מבסיס השיער בשורשים — לא רק מהשם של הצבע.

אפשר גם לענות עם תמונה באור טבעי וננסה לכוון.

[כפתור: למדריך הגוונים]

## BR02

- Timing: Day 1, only after continued interest or a relevant click.
- Subject: `למי NovaHair יכול להתאים—ולמי פחות`
- Preview: `כמה דקות לקרוא לפני שמחליטים.`
- CTA: `לבדוק אם זה מתאים לי` → `PRODUCT_URL#faq`

NovaHair יכול להתאים למי שמחפשת דרך ביתית לכסות שיער לבן, במיוחד בשורשים, ומוכנה לבחור גוון ולעבוד לפי ההוראות.

אם את מחפשת שינוי צבע מורכב או לא בטוחה מה בסיס השיער שלך, עדיף קודם להתייעץ ולא להזמין מתוך ניחוש.

[כפתור: לבדוק אם זה מתאים לי]

## BR03

- Timing: Day 3, only if still eligible.
- Subject: `שלושה דברים לבדוק לפני שמחליטים`
- Preview: `הגוון, אופן השימוש והמדיניות.`
- CTA: `לחזור לעמוד NovaHair` → `PRODUCT_URL`

לפני החלטה, בדקי שלושה דברים: האם יש גוון שמתאים לבסיס שלך, האם דרך השימוש נוחה לך, והאם תנאי המשלוח והאחריות ברורים.

אם שלושתם מרגישים נכונים, כל הפרטים נמצאים בעמוד. אם לא, אפשר לענות ולשאול.

[כפתור: לחזור לעמוד NovaHair]

---

# E. Post-Purchase — 9 emails

PP01–PP04 are operational/educational and must not contain cross-sell. PP05–PP09 require a real delivery/pickup anchor. Pause PP08–PP09 while a service case is open.

## PP01 — order assurance

- Timing: 4 hours after a real paid Shopify order, unless the Shopify order confirmation already contains every element below.
- Subject: `ההזמנה שלך התקבלה—ומה קורה מכאן`
- Preview: `משלוח, מעקב, תמיכה והשם שיופיע באשראי.`
- CTA: `לצפייה בהזמנה` → `ORDER_STATUS_URL`

היי {{first_name}},

הזמנה {{order_number}} התקבלה והיא בטיפול.

המשלוח לישראל מגיע בדרך כלל בתוך 5–14 ימי עסקים ממועד ההזמנה, לרוב לנקודת איסוף. מספר המעקב יכול להופיע אחרי שההזמנה כבר בטיפול, ולכן אין סיבה להילחץ אם הוא עדיין לא מופיע עכשיו.

בפירוט האשראי החיוב יכול להופיע בשם **NOVAHAIR**.

אם משהו בהזמנה לא נראה נכון, עני למייל הזה ונבדוק.

[כפתור: לצפייה בהזמנה]

## PP02 — prepare without implying delivery

- Timing: Day 2 after purchase.
- Subject: `שלושה דברים שכדאי להכין לשימוש הראשון`
- Preview: `כפפות, דרך מריחה וכמה דקות לקריאת ההוראות.`
- CTA: `לשמור את מדריך השימוש` → `HOW_TO_URL`

החבילה עדיין בדרך, אבל אפשר לשמור את זה לפעם הראשונה:

1. הכיני כפפות, מברשת אם נוח לך ומגבת שלא אכפת לך ללכלך.
2. קראי את ההוראות לפני שמתחילים.
3. בפעם הראשונה, תני תשומת לב מיוחדת לשורשים ולאזורים הלבנים.

אין כאן שום הנחה שהחבילה כבר נמסרה.

[כפתור: לשמור את מדריך השימוש]

## PP03 — real tracking event

- Trigger: first reliable `TRACKING_ASSIGNED` or `CARRIER_PICKED_UP`; send only if Shopify did not send the same purpose.
- Subject: `יש עדכון מעקב להזמנה שלך`
- Preview: `אפשר לראות את המצב העדכני בקישור.`
- CTA: `למעקב אחר המשלוח` → `TRACKING_URL`

היי {{first_name}},

יש עדכון חדש להזמנה {{order_number}}. המשלוח קיבל פרטי מעקב{{#if carrier_picked_up}} ונקלט אצל חברת המשלוחים{{/if}}.

המידע בקישור מתעדכן לפי חברת המשלוחים, ולעיתים יש פער בין סריקה אחת לבאה.

[כפתור: למעקב אחר המשלוח]

אם משהו לא ברור, אפשר לענות למייל.

## PP04 — only when there is a real delay

- Trigger: `DELAYED`, no movement threshold, or promise-risk rule. Never fixed Day 14 without evidence.
- Subject: `עדכון חשוב לגבי המשלוח שלך`
- Preview: `שמנו לב שהעדכון הבא מתעכב, ואנחנו עוקבות.`
- CTA: `למצב המשלוח` → `TRACKING_URL`

היי {{first_name}},

שמנו לב שלא התקבל עדכון חדש למשלוח {{order_number}} בזמן שציפינו.

המשלוח עדיין מופיע אצלנו כ‑{{safe_status}}, ואנחנו בודקות את המצב מול נתוני המשלוח. נעדכן אם יהיה שינוי שדורש ממך פעולה.

[כפתור: למצב המשלוח]

אם את מעדיפה שנבדוק את ההזמנה באופן אישי, פשוט עני למייל הזה.

## PP05 — first use

- Timing: 1 day after real `DELIVERED` or confirmed `PICKED_UP`.
- Subject: `החבילה אצלך? הנה השימוש הראשון`
- Preview: `צעד אחר צעד, עם דגש על השורשים.`
- CTA: `למדריך המלא` → `HOW_TO_URL`

היי {{first_name}},

לפי המעקב, החבילה נמסרה או נאספה. אם היא אכן אצלך, הנה הדרך הפשוטה להתחיל:

1. קראי את ההוראות שמצורפות למוצר.
2. הכיני כפפות או מברשת, אם זה נוח לך.
3. מרחי היטב על השורשים והשיער הלבן.
4. המתיני לפי ההוראות—ברוב המקרים בערך 10–15 דקות.
5. שטפי היטב.

[כפתור: למדריך המלא]

אם החבילה לא אצלך למרות סטטוס המעקב, לחצי כאן: [החבילה לא הגיעה] → `DELIVERY_MISSING_URL`.

## PP06 — troubleshooting

- Timing: 4 days after delivery, unless the customer said she has not tried it.
- Subject: `אם השימוש הראשון לא יצא בדיוק כמו שציפית`
- Preview: `לפני שמוותרים, בואי נבדוק גוון, כיסוי וזמן.`
- CTA: reply or `SUPPORT_URL`.

אם כבר ניסית והתוצאה לא מרגישה מדויקת, אל תישארי עם סימן שאלה.

כתבי לנו מה קרה: האם הבעיה הייתה בגוון, בכיסוי של השיער הלבן, בכמות או במריחה. אם נוח לך, אפשר לצרף תמונה באור טבעי בתשובה למייל.

ננסה להבין מה אפשר לשפר לפני השימוש הבא.

## PP07 — care and result maintenance

- Timing: 10 days after delivery, only if no issue is open.
- Subject: `איך לשמור על התוצאה בין שימושים`
- Preview: `כמה הרגלים פשוטים בלי להעמיס על השיער.`
- CTA: `למדריך הטיפול` → `HOW_TO_URL`

כדי לשמור על מראה אחיד, התמקדי בשורשים כשזה האזור שצריך חידוש ואל תעמיסי חומר על כל האורך בלי צורך.

עקבי אחרי ההוראות שעל המוצר והשאירי לעצמך מספיק חומר לפעם הבאה בהתאם לקצב השימוש שלך.

[כפתור: למדריך הטיפול]

## PP08 — satisfaction gate before review

- Timing: 14 days after delivery, only if no issue is open.
- Subject: `איך היה השימוש הראשון?`
- Preview: `שתי תשובות קצרות יעזרו לנו לשלוח את הדבר הנכון.`
- CTA: signed responses.

היי {{first_name}},

אם כבר ניסית, איך היה?

- [היה טוב] → `FIRST_USE_HAPPY_URL`
- [אני צריכה עזרה] → `FIRST_USE_HELP_URL`
- [עוד לא ניסיתי] → `FIRST_USE_NOT_YET_URL`

רק מי שבוחרת “היה טוב” עוברת לבקשת ביקורת. בחירת “צריכה עזרה” פותחת מקרה שירות ועוצרת מכירה נוספת.

## PP09 — relevant cross-sell

- Timing: 21 days after delivery, only if satisfied/no issue and product not already purchased.
- Subject: `מה יכול להשלים את שגרת השיער שלך?`
- Preview: `המלצה אחת בלבד, לפי מה שכבר קנית.`
- CTA: `לראות את {{recommended_product}}` → `CROSS_SELL_URL`

אם NovaHair כבר נכנס לשגרה שלך, אפשר להשלים אותה עם {{recommended_product}}—רק אם הוא מתאים לצורך שלך ורק אם הוא לא היה בהזמנה הקודמת.

{{dynamic_cross_sell_reason}}

[כפתור: לראות את {{recommended_product}}]

אם זה לא רלוונטי, לא צריך לעשות דבר.

---

# F. Replenishment — 4 emails

Anchor is a bundle/quantity model adjusted by real repeat-purchase behavior and signed customer responses. Stop on purchase or “pause”.

## R01

- Timing: base window 60/105/150 days for 2/4/6 bottles, moved earlier by shipping lead time when appropriate.
- Subject: `נשאר לך מספיק לפעם הבאה?`
- Preview: `לא נניח שנגמר—את יודעת טוב יותר מאיתנו.`
- CTA: signed stock responses.

היי {{first_name}},

רצינו לבדוק מה מצב המלאי שלך אחרי חבילת {{bundle}}.

- [כדאי לי להזמין] → `REORDER_NOW_URL`
- [יש לי מספיק—תזכירו לי בעוד חודש] → `REMIND_30_URL`
- [אני כבר לא משתמשת] → `PAUSE_REPLENISHMENT_URL`

המשלוח מגיע בדרך כלל בתוך 5–14 ימי עסקים, לכן עדיף להזמין לפני שנגמר — לא אחרי.

## R02

- Timing: 7 days after R01, only if no response/purchase.
- Subject: `הגוון והחבילה הקודמים שמורים כאן`
- Preview: `בלי להתחיל את הבחירה מחדש.`
- CTA: `להזמין שוב` → `REORDER_URL`

בהזמנה הקודמת בחרת {{variant}} בחבילת {{bundle}}.

אם זה עדיין מה שמתאים לך, אפשר לחזור לאותה בחירה. אם תרצי לשנות גוון או כמות, עני למייל ונעזור.

[כפתור: להזמין שוב]

## R03

- Timing: 17 days after R01.
- Subject: `הפעם לבחור לפי קצב השימוש שלך`
- Preview: `2, 4 או 6—לפי מה שבאמת הספקת להשתמש.`
- CTA: `להשוות חבילות` → `PRODUCT_URL#bundles`

אם נשאר לך הרבה מהמלאי הקודם, אין סיבה לעלות חבילה. אם השתמשת מהר יותר מהצפוי, אולי חבילה גדולה יותר תחסוך הזמנות תכופות.

{{dynamic_repeat_purchase_guidance}}

[כפתור: להשוות חבילות]

## R04

- Timing: 38 days after R01.
- Subject: `להמשיך להזכיר לך בעתיד?`
- Preview: `בחרי מה נוח לך ונעדכן את התזמון.`
- CTA: signed preference links.

לא רצינו להמשיך לנחש את הקצב שלך.

- [כן, תזכירו לי בעוד חודש]
- [כן, אבל בעוד שלושה חודשים]
- [לא צריך להזכיר לי]

הבחירה מעדכנת את התזמון ולא מחייבת רכישה.

---

# G. Conditional shipment and service templates — 12

These are transactional, state-specific and offer-free. Send only after duplicate-notification ownership is verified.

## S01 — supplier processing, customer update approved

- Trigger: no tracking after 2–3 business days and an internal check confirms the order is valid and progressing.
- Subject: `עדכון קצר על הזמנה {{order_number}}`
- Preview: `ההזמנה בטיפול; המעקב עדיין לא נפתח.`

היי {{first_name}},

הזמנה {{order_number}} בטיפול, אבל מספר המעקב עדיין לא נפתח. זה יכול לקרות לפני שהמשלוח נקלט אצל חברת השילוח.

אנחנו ממשיכות לעקוב. אין צורך לעשות דבר כרגע. אם יש לך שאלה, אפשר לענות למייל הזה.

## S02 — no movement

- Trigger: no new carrier event for 3 business days, one send per state version.
- Subject: `שמנו לב שאין עדכון חדש במעקב`
- Preview: `אנחנו בודקות את זה ולא משאירות אותך לנחש.`

היי {{first_name}},

שמנו לב שלא הופיע עדכון חדש במעקב של הזמנה {{order_number}} בימים האחרונים.

הסטטוס האחרון הוא: {{safe_status}} בתאריך {{last_event_date}}.

אנחנו עוקבות אחר השינוי הבא. אם תרצי בדיקה אישית, עני למייל הזה.

[כפתור: לצפייה במעקב] → `TRACKING_URL`

## S03 — explicit delay / promise risk

- Trigger: explicit delay or business day 10 without imminent delivery.
- Subject: `יש עיכוב במשלוח שלך—אנחנו עוקבות`
- Preview: `הנה המצב האחרון ומה אנחנו עושות עכשיו.`

היי {{first_name}},

המשלוח של הזמנה {{order_number}} מתעכב ביחס לקצב הרגיל.

העדכון האחרון שקיבלנו הוא: {{safe_status}}. אנחנו ממשיכות לבדוק, וניצור איתך קשר אם יהיה צורך בפעולה או בפרט נוסף.

אם ההזמנה דחופה לך, עני למייל ונבדוק את המקרה באופן אישי.

## S04 — ready for pickup

- Trigger: `READY_FOR_PICKUP`.
- Subject: `החבילה שלך מחכה בנקודת האיסוף`
- Preview: `כדאי לבדוק את פרטי האיסוף והזמן שנותר.`

היי {{first_name}},

לפי עדכון המשלוח, הזמנה {{order_number}} מוכנה לאיסוף.

בדקי בקישור את נקודת האיסוף, שעות הפעילות וההנחיות המעודכנות של חברת המשלוחים.

[כפתור: לפרטי האיסוף] → `TRACKING_URL`

## S05 — pickup reminder

- Trigger: 2–3 days after ready for pickup, only if not picked up/delivered.
- Subject: `תזכורת קטנה: החבילה עדיין מחכה לאיסוף`
- Preview: `כדאי לבדוק עד מתי היא נשמרת בנקודה.`

היי {{first_name}},

לפי המעקב, החבילה עדיין מחכה בנקודת האיסוף. כדאי לבדוק עד מתי היא נשמרת שם כדי שלא תוחזר לשולח.

[כפתור: לפרטי האיסוף] → `TRACKING_URL`

אם כבר אספת אותה, אפשר להתעלם מהמייל הזה.

## S06 — buyer action required

- Trigger: `BUYER_ACTION_REQUIRED`.
- Subject: `נדרשת פעולה כדי שהמשלוח ימשיך`
- Preview: `בדקי את ההנחיה של חברת המשלוחים.`

היי {{first_name}},

חברת המשלוחים סימנה שנדרשת פעולה מצדך כדי להמשיך את מסירת הזמנה {{order_number}}.

פתחי את המעקב ובדקי את ההנחיה העדכנית. אם משהו לא ברור, עני למייל וננסה לעזור.

[כפתור: לפתיחת המעקב] → `TRACKING_URL`

## S07 — attempted delivery

- Trigger: `ATTEMPTED_DELIVERY`.
- Subject: `ניסיון המסירה לא הושלם`
- Preview: `הנה המקום לבדוק מה הצעד הבא.`

לפי המעקב, נעשה ניסיון למסור את הזמנה {{order_number}}, אבל המסירה לא הושלמה.

בדקי בקישור אם צריך לתאם ניסיון נוסף, לעדכן פרט או לאסוף את החבילה.

[כפתור: לבדוק מה הצעד הבא] → `TRACKING_URL`

## S08 — returning to sender

- Trigger: `RETURNING_TO_SENDER`; opens service case and pauses lifecycle marketing.
- Subject: `אנחנו צריכות לבדוק איתך את המשלוח`
- Preview: `המשלוח מסומן כחוזר לשולח.`

היי {{first_name}},

קיבלנו עדכון שהמשלוח של הזמנה {{order_number}} מסומן כחוזר לשולח.

פתחנו בדיקה כדי להבין מה קרה ומה האפשרות הנכונה עבורך. עני למייל הזה כדי שנוכל לוודא את הפרטים ולהגיע לפתרון.

## S09 — delivery acknowledgement

- Trigger: one day after `DELIVERED`/`PICKED_UP`.
- Subject: `רק לוודא—החבילה הגיעה אלייך?`
- Preview: `תשובה אחת תעביר אותך למסלול הנכון.`

לפי המעקב, הזמנה {{order_number}} נמסרה או נאספה.

- [כן, החבילה אצלי] → `DELIVERY_CONFIRMED_URL`
- [לא, היא לא אצלי] → `DELIVERY_MISSING_URL`

אם היא לא אצלך, נפתח בדיקה ונעצור בינתיים מיילים על שימוש וביקורת.

## S10 — service case acknowledgement

- Trigger: signed issue response or support integration.
- Subject: `קיבלנו את הפנייה שלך לגבי הזמנה {{order_number}}`
- Preview: `הפנייה נפתחה; אין צורך לשלוח אותה שוב.`

היי {{first_name}},

קיבלנו את הפנייה שלך לגבי {{case_reason}} ופתחנו בדיקה.

אין צורך לשלוח את אותה פנייה שוב. אם יש פרט חדש, אפשר להשיב למייל הזה והוא יצורף לטיפול.

## S11 — service resolution

- Trigger: human marks the service case resolved.
- Subject: `עדכון לגבי הטיפול בהזמנה {{order_number}}`
- Preview: `הנה הסיכום ומה קורה עכשיו.`

היי {{first_name}},

סיימנו את הבדיקה לגבי ההזמנה שלך.

{{human_approved_resolution_summary}}

אם משהו עדיין לא ברור, עני למייל הזה והפנייה תיפתח מחדש.

## S12 — refund processed

- Trigger: real Shopify refund transaction.
- Subject: `ההחזר עבור הזמנה {{order_number}} בוצע`
- Preview: `הסכום והמועד מופיעים כאן.`

היי {{first_name}},

החזר בסך {{refund_amount}} {{currency}} בוצע עבור הזמנה {{order_number}} בתאריך {{refund_date}}.

הזמן עד שהסכום מופיע בחשבון תלוי בחברת האשראי או באמצעי התשלום. אם הסכום לא מופיע לאחר הזמן המקובל אצלם, אפשר לענות למייל ונעזור לבדוק את פרטי העסקה.

---

# H. Decision-help response emails — 4

Send one matching response after a signed blocker click; suppress equivalent generic education for seven days.

## D01 — shade

- Subject: `בואי נפתור את עניין הגוון`
- Preview: `שתי דרכים לבדוק בלי לנחש.`

התחילי מבסיס השיער בשורשים ומהתוצאה שאת רוצה לקבל. אם את בין שני גוונים, אפשר לבחור חבילה שמשלבת גוונים או לענות לנו עם תמונה באור טבעי.

[כפתור: למדריך הגוונים] → `SHADE_GUIDE_URL`

## D02 — coverage

- Subject: `מה חשוב לדעת על כיסוי שיער לבן`
- Preview: `הגוון והמריחה משפיעים על התוצאה.`

NovaHair מיועד לכיסוי שיער לבן. לכיסוי אחיד, בחרי גוון קרוב לבסיס, מרחי מספיק חומר על האזור הלבן והמתיני לפי ההוראות.

[בלוק הוכחה מאושר]

[כפתור: לראות הדגמה ותוצאות] → `REVIEWS_URL`

## D03 — shipping

- Subject: `כל מה שחשוב לדעת על המשלוח`
- Preview: `זמן, מעקב ונקודת איסוף.`

המשלוח מיועד לישראל ומגיע בדרך כלל בתוך 5–14 ימי עסקים ממועד ההזמנה, לרוב לנקודת איסוף. מספר המעקב יכול להופיע אחרי שההזמנה כבר בטיפול.

אם יש לך שאלה על אזור מסוים, אפשר לענות למייל.

[כפתור: למדיניות המשלוחים] → `POLICY_URL`

## D04 — price/bundle

- Subject: `איזו חבילה נותנת לך ערך נכון?`
- Preview: `לפי קצב השימוש, לא לפי לחץ לקנות יותר.`

החבילות מגיעות ב‑2, 4 או 6 בקבוקים, ואפשר לשלב גוונים. חבילה גדולה יותר יכולה להוריד את המחיר לבקבוק, אבל היא משתלמת רק אם הכמות באמת מתאימה לקצב השימוש שלך.

{{dynamic_bundle_comparison}}

[כפתור: להשוות את המחירים העדכניים] → `PRODUCT_URL#bundles`

---

# I. Long nurture for non-buyers — 4 emails

These replace indefinite weekly reminders. Only for consented subscribers with no Cart/Checkout/Purchase and recent engagement. Stop after two consecutive messages without a meaningful click.

## LN01 — Day 30

- Subject: `שאלה אחת שכדאי לשאול לפני צבע ביתי`
- Preview: `האם הפתרון מתאים לבסיס השיער ולשגרה שלך?`

לפני שבוחרים פתרון ביתי, חשוב לבדוק לא רק את ההבטחה — אלא גם אם הגוון מתאים, אם דרך השימוש נוחה ואם יש עם מי לדבר כשצריך.

[כפתור: לבדוק התאמה] → `PRODUCT_URL#faq`

## LN02 — Day 45

- Subject: `הדגמה קצרה שעדיפה על עוד הסבר`
- Preview: `כך נראה השימוש על אזור השורשים.`

[וידאו הדגמה מאושר]

אם זו הדרך שחיפשת, כל פרטי השימוש נמצאים כאן.

[כפתור: לצפייה במדריך] → `HOW_TO_URL`

## LN03 — Day 60

- Subject: `מתלבטת בין שני גוונים?`
- Preview: `אפשר לשלב—ואפשר גם לשאול אותנו.`

לא תמיד חייבים להכריע בין שני שמות של גוונים. אפשר לשלב גוונים שונים בחבילה, או לענות עם תמונה באור טבעי כדי לקבל כיוון.

[כפתור: למדריך הגוונים] → `SHADE_GUIDE_URL`

## LN04 — Day 90

- Subject: `NovaHair עדיין רלוונטי לך?`
- Preview: `בחרי אם להמשיך, להאט או לעצור.`

- [כן, אני עדיין בודקת]
- [תזכירו לי בעוד שלושה חודשים]
- [לא רלוונטי לי כרגע]

נעדכן את התדירות לפי הבחירה שלך.

---

# J. Repeat-customer flow — 3 emails

Use instead of beginner Welcome for a customer with a completed prior NovaHair order.

## RC01 — saved choice

- Trigger: returning customer shows product/cart intent.
- Subject: `רוצה לחזור לגוון הקודם שלך?`
- Preview: `{{variant}} וחבילת {{bundle}} שמורים כנקודת התחלה.`

בהזמנה הקודמת בחרת {{variant}} בחבילת {{bundle}}.

אם זה עדיין מתאים, אפשר להתחיל מאותה בחירה. אם משהו השתנה בשיער או בקצב השימוש, עני למייל ונעזור להתאים מחדש.

[כפתור: להזמנה חוזרת] → `REORDER_URL`

## RC02 — usage-adjusted bundle

- Timing: 5 days after RC01 if no purchase.
- Subject: `נשאר לך הרבה—או שנגמר מהר מהצפוי?`
- Preview: `התשובה תעזור לבחור את החבילה הבאה.`

- [נשאר לי מספיק]
- [הכמות התאימה]
- [נגמר מהר]

לפי הבחירה, נמליץ על 2, 4 או 6 בקבוקים בלי להניח שחבילה גדולה תמיד טובה יותר.

## RC03 — conditional complement

- Timing: 10 days after RC01, only if no purchase and no service issue.
- Subject: `מוצר משלים אחד, רק אם הוא חסר לך`
- Preview: `לא נמליץ על מה שכבר קנית.`

לפי ההזמנה הקודמת, {{recommended_product}} לא היה בחבילה שלך ויכול להתאים ל‑{{approved_use_case}}.

[כפתור: לראות פרטים] → `CROSS_SELL_URL`

אם הוא לא רלוונטי לשגרה שלך, אין צורך להוסיף דבר.

---

# Internal-only dispute notification — no customer automation

## INT-DISPUTE-01

- Trigger: verified Shopify `DISPUTES_CREATE` webhook.
- Audience: owner/support only.
- Subject: `[פעולה נדרשת] מחלוקת חדשה — {{order_number}}`

נפתחה מחלוקת חדשה עבור {{order_number}} בסך {{amount}} {{currency}}, סיבה: {{reason}}, מועד אחרון: {{evidence_due_at}}.

מצב משלוח: {{normalized_shipping_state}}. מסירה/איסוף: {{delivery_timestamp_or_none}}. פנייה פתוחה: {{service_case_state}}. החזר קיים: {{refund_state}}.

[כפתור: לפתיחת תיק הראיות המאובטח] → `ADMIN_EVIDENCE_URL`

אין לשלוח ללקוחה נוסח אוטומטי מאשים או מאיים. כל פנייה דורשת בדיקה ואישור אנושי.

---

# Publishing checklist for every template

1. Subject and preview describe what the email actually contains.
2. One dominant purpose and one primary CTA.
3. Every claim has an approved source or owned proof asset.
4. Every link has a distinct semantic variable and correct UTM where commercial.
5. Recovery/tracking links preserve existing query parameters through a URL parser.
6. RTL, mobile, Gmail, Apple Mail and Outlook practical rendering pass.
7. Service emails contain no promotion.
8. Marketing templates include `{{{RESEND_UNSUBSCRIBE_URL}}}` and suppression checks.
9. Trigger, eligibility, stop event, frequency cap and notification owner are recorded beside the template ID.
10. A real event-to-email test passes before the template is enabled.
