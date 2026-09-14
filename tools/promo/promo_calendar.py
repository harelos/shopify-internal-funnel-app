# -*- coding: utf-8 -*-
"""The September promotion calendar.

Built on the Israeli month rather than an American retail one. Tishrei falls
almost entirely inside September 2026, and that is what actually governs when
Israeli shoppers buy:

  11-13 Sep  Rosh Hashanah        already past
  14 Sep     Tzom Gedaliah        today
  15-19 Sep  between the holidays  people restock
  20-21 Sep  Yom Kippur            the country stops. The store goes dark.
  22-24 Sep  after the fast        back to normal, pre-Sukkot shopping
  25 Sep     erev Sukkot
  26 Sep     Sukkot, first day     chag
  27-30 Sep  chol hamoed           long evenings, high browsing

Shape is borrowed from Ulta's 21 Days of Beauty, which is the proven mechanic:
one hero offer that changes every day, a running weekly offer underneath it, and
the next days visible so there is a reason to come back. The depth is not
borrowed. Ulta discounts 50%; that works for a retailer discounting someone
else's brand. Here a standing 50% would train the customer to wait, so the
daily offer sits at 25 to 30 percent and the weekly one at 20.

The two dark days are deliberate. A beauty sale running through Yom Kippur is
the kind of thing an Israeli customer remembers about a brand.
"""

TITLE = "שבועיים של טיפוח"
EYEBROW = "מבצעי ספטמבר"
INTRO = ("כל יום מוצר אחד במחיר מיוחד, עד חצות. "
         "בערב יום כיפור ובמהלכו אין מבצעים ואין דיוור.")

# handle, percent off, the one line that says why this product today, and the
# teaser that shows in the upcoming list before the offer opens
DAYS = [
    ("2026-09-15", "novahair-root-touchup-spray", 30,
     "השורש שיצא אחרי ראש השנה, מכוסה עד החפיפה הבאה.",
     "ספריי כיסוי שורשים"),
    ("2026-09-16", "novahair-keratin-mask", 30,
     "עשר דקות על שיער סחוט מגבת, פעם בשבוע.",
     "מסכת קרטין"),
    ("2026-09-17", "novahair-argan-oil", 25,
     "לקצוות שספגו את כל הצביעות של השנה.",
     "שמן ארגן"),
    ("2026-09-18", "novahair-rosemary-duo", 30,
     "שמפו ומרכך מאותה סדרה, לשגרה שלמה.",
     "סט שמפו ומרכך"),
    ("2026-09-19", "novahair-daily-shampoo", 25,
     "השמפו לימים שבהם החפיפה רק צריכה לנקות.",
     "שמפו יומיומי"),

    # ---- dark ----
    ("2026-09-20", None, 0, None, None),
    ("2026-09-21", None, 0, None, None),

    ("2026-09-22", "novahair-scalp-serum", 30,
     "אחרי צום, הקרקפת היא הדבר הראשון שמרגיש את זה.",
     "סרום לקרקפת"),
    ("2026-09-23", "novahair-fruit-color-cream", 25,
     "קו השורש, בלי קערה ובלי כפפות.",
     "קרם צבע עם מסרק"),
    ("2026-09-24", "novahair-peptide-shampoo", 30,
     "שמפו שעובד על הקרקפת ולא על האורך.",
     "שמפו פפטידים"),
    ("2026-09-25", "novahair-coloring-kit", 30,
     "הכלים שהופכים צביעה ביתית למסודרת.",
     "ערכת צביעה"),
    ("2026-09-26", "novahair-heatless-curler", 25,
     "גלים שנוצרים בלילה, בלי חום ובלי נזק.",
     "מקל תלתלים"),
    ("2026-09-27", "novaglow-matcha-body-scrub", 30,
     "פילינג אחד בשבוע, על עור לח ולא רטוב.",
     "פילינג גוף מאצ'ה"),
    ("2026-09-28", "novaglow-pdrn-serum", 30,
     "הסרום שהפך למדובר בטיפוח הקוריאני.",
     "סרום PDRN"),
    ("2026-09-29", "novahair-batana-oil-120", 30,
     "טיפול שבועי לשיער שעבר צביעה והחלקה.",
     "שמן בטאנה"),
    ("2026-09-30", "novahair-self-cleaning-brush", 30,
     "מברשת שמתנקה בלחיצה אחת.",
     "מברשת מתנקה"),
]

DARK = {
    "2026-09-20": ("ערב יום כיפור", "החנות שקטה היום. אין מבצעים ואין דיוור."),
    "2026-09-21": ("יום כיפור", "גמר חתימה טובה. נחזור מחר."),
}

WEEKS = [
    dict(**{"from": "2026-09-15", "to": "2026-09-19"},
         title="20% על כל טיפוח השיער",
         body="כל השמפו, המסכות והשמנים באוסף טיפוח שיער, לאורך כל השבוע.",
         url="/collections/hair-care", cta="לאוסף טיפוח שיער", percent=20,
         collection="hair-care"),
    dict(**{"from": "2026-09-22", "to": "2026-09-30"},
         title="20% על טיפוח קרקפת",
         body="סרומים, שמנים ואמפולות לקרקפת, עד סוף החודש.",
         url="/collections/scalp-care", cta="לאוסף טיפוח קרקפת", percent=20,
         collection="scalp-care"),
]


def build():
    days = []
    for date, handle, off, line, teaser in DAYS:
        if handle is None:
            t, b = DARK[date]
            days.append({"date": date, "dark": True, "dark_title": t, "dark_body": b,
                         "teaser": t})
            continue
        days.append({
            "date": date,
            "dark": False,
            "handle": handle,
            "percent_off": off,
            # the template multiplies by this rather than subtracting, so Liquid
            # integer maths cannot drift a shekel
            "keep_percent": 100 - off,
            "label": "המבצע של היום",
            "line": line,
            "teaser": teaser,
        })

    return {
        "title": TITLE,
        "eyebrow": EYEBROW,
        "intro": INTRO,
        "schedule_visible": True,
        "closed_title": "המבצעים חזרו למדף",
        "closed_body": "הסבב של ספטמבר הסתיים. הקטלוג המלא פתוח כרגיל.",
        "days": days,
        "weeks": [{k: w[k] for k in ("from", "to", "title", "body", "url", "cta")}
                  for w in WEEKS],
    }


if __name__ == "__main__":
    import json
    print(json.dumps(build(), ensure_ascii=False, indent=1))
