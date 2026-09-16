# -*- coding: utf-8 -*-
"""The September promotion calendar.

Built on the Israeli month rather than an American retail one. Tishrei falls
almost entirely inside September 2026, and that is what actually governs when
Israeli shoppers buy:

  11-13 Sep  Rosh Hashanah        already past
  15-19 Sep  between the holidays  people restock
  20-21 Sep  Yom Kippur            the country stops. The store goes dark.
  22-24 Sep  after the fast        back to normal, pre-Sukkot shopping
  25 Sep     erev Sukkot
  26-30 Sep  chag and chol hamoed  long evenings, high browsing

The shape is Ulta's 21 Days of Beauty: one offer that changes daily, a running
weekly offer underneath, and the next days visible so there is a reason to come
back. The depth is not borrowed. Ulta discounts 50% because it is discounting
someone else's brand; a standing half price here would train the customer to
wait, and these products have no price history to discount from honestly.

Three kinds of day, because a single SKU every day for two weeks is monotonous
and it never raises the basket:

  product  one hero. Best for a product that sells itself.
  theme    three products around one job. "Scalp day" beats "another serum".
  bundle   a routine bought together, at the deepest discount of the three,
           because that is the day that moves average order value.
"""

TITLE = "שבועיים של טיפוח"
EYEBROW = "מבצעי ספטמבר"
INTRO = ("כל יום מבצע אחר, עד חצות. יש ימים של מוצר אחד, ימים של נושא "
         "וימים של שגרה שלמה. בערב יום כיפור ובמהלכו אין מבצעים ואין דיוור.")

# date, kind, percent, headline, one line saying why, list of handles
DAYS = [
    ("2026-09-15", "product", 30, "ספריי כיסוי שורשים",
     "השורש שיצא אחרי ראש השנה, מכוסה עד החפיפה הבאה.",
     ["novahair-root-touchup-spray"]),

    ("2026-09-16", "theme", 25, "יום הצבע",
     "שלוש הדרכים לכסות שיער לבן בבית, כל אחת לסוג אחר של סבלנות.",
     ["novahair-fruit-color-cream", "novahair-black-color-shampoo",
      "novahair-botanical-color-shampoo"]),

    ("2026-09-17", "product", 25, "שמן ארגן לשיער",
     "לקצוות שספגו את כל הצביעות של השנה.",
     ["novahair-argan-oil"]),

    ("2026-09-18", "bundle", 30, "שגרת החפיפה המלאה",
     "שמפו, מסכה ושמן גימור. שלושת השלבים שעושים את ההבדל בשיער צבוע.",
     ["novahair-botanic-shampoo", "novahair-hyaluronic-mask", "novahair-argan-oil"]),

    ("2026-09-19", "product", 25, "שמפו יומיומי",
     "השמפו לימים שבהם החפיפה רק צריכה לנקות.",
     ["novahair-daily-shampoo"]),

    ("2026-09-20", "dark", 0, "ערב יום כיפור",
     "החנות שקטה היום. אין מבצעים ואין דיוור.", []),
    ("2026-09-21", "dark", 0, "יום כיפור",
     "גמר חתימה טובה. נחזור מחר.", []),

    ("2026-09-22", "theme", 30, "יום הקרקפת",
     "אחרי צום, הקרקפת היא הדבר הראשון שמרגיש את זה.",
     ["novahair-growth-serum", "novahair-scalp-serum", "novahair-scalp-massager"]),

    ("2026-09-23", "product", 25, "קרם צבע עם מסרק",
     "קו השורש, בלי קערה ובלי כפפות.",
     ["novahair-fruit-color-cream"]),

    ("2026-09-24", "bundle", 30, "ערכת הצביעה המלאה",
     "הצבע, הכלים והשמפו שישמור עליו. כל מה שצריך לסבב שורשים אחד.",
     ["novahair-fruit-color-cream", "novahair-coloring-kit", "novahair-botanic-shampoo"]),

    ("2026-09-25", "product", 30, "ערכת צביעה ביתית",
     "הכלים שהופכים צביעה ביתית למסודרת.",
     ["novahair-coloring-kit"]),

    ("2026-09-26", "theme", 25, "יום השמנים",
     "שלושה שמנים, שלוש עבודות שונות. קרקפת, אורך וקצוות.",
     ["novahair-rosemary-oil", "novahair-batana-oil-50", "novahair-coconut-oil"]),

    ("2026-09-27", "product", 30, "פילינג גוף מאצ'ה",
     "פילינג אחד בשבוע, על עור לח ולא רטוב.",
     ["novaglow-matcha-body-scrub"]),

    ("2026-09-28", "theme", 25, "יום הפנים",
     "שלושת הסרומים של NovaGlow, לשלוש בעיות שונות.",
     ["novaglow-pdrn-serum", "novaglow-copper-peptide-serum", "novaglow-azelaic-acid-10"]),

    ("2026-09-29", "product", 30, "שמן בטאנה 120 מ\"ל",
     "טיפול שבועי לשיער שעבר צביעה והחלקה.",
     ["novahair-batana-oil-120"]),

    ("2026-09-30", "bundle", 30, "הסט לשיער שעבר יותר מדי",
     "שמפו קרטין, מסכת קרטין ושמן בטאנה. הטיפול המלא לשיער פגום.",
     ["novahair-keratin-shampoo", "novahair-keratin-mask", "novahair-batana-oil-50"]),
]

# The weekly offer runs against a collection, so it is only as stable as the
# shelf underneath it. hair-care and scalp-care were deleted on 15 Sep in the
# collection restructure, which expired both weekly discounts within the same
# minute and left the page advertising 20% on two URLs that now 404. Repointed
# at the mission shelves that replaced them: mission-repair is the shampoo,
# mask and oil shelf the first week was always describing, and mission-scalp is
# a near exact stand-in for scalp-care. Pick a shelf here that the restructure
# is not about to move again.
WEEKS = [
    dict(**{"from": "2026-09-15", "to": "2026-09-19"},
         title="20% על שמפו, מסכות ושמנים",
         body="כל השמפו, המסכות והשמנים באוסף שיקום, לחות וברק, לאורך כל השבוע.",
         url="/collections/mission-repair", cta="לאוסף שיקום ולחות", percent=20,
         collection="mission-repair"),
    dict(**{"from": "2026-09-22", "to": "2026-09-30"},
         title="20% על טיפוח קרקפת",
         body="סרומים, שמנים ואמפולות לקרקפת, עד סוף החודש.",
         url="/collections/mission-scalp", cta="לאוסף טיפוח קרקפת", percent=20,
         collection="mission-scalp"),
]

LABEL = {
    "product": "המבצע של היום",
    "theme": "הנושא של היום",
    "bundle": "השגרה של היום",
}


def build():
    days = []
    for date, kind, off, headline, line, handles in DAYS:
        if kind == "dark":
            days.append({"date": date, "dark": True, "kind": "dark",
                         "dark_title": headline, "dark_body": line,
                         "teaser": headline})
            continue
        days.append({
            "date": date,
            "dark": False,
            "kind": kind,
            "headline": headline,
            "handles": handles,
            # kept so older renders and the checker still work
            "handle": handles[0],
            "percent_off": off,
            "keep_percent": 100 - off,
            "label": LABEL[kind],
            "line": line,
            "teaser": headline,
        })

    return {
        "title": TITLE,
        "eyebrow": EYEBROW,
        "intro": INTRO,
        "schedule_visible": True,
        "closed_title": "המבצעים חזרו למדף",
        "closed_body": "הסבב של ספטמבר הסתיים. הקטלוג המלא פתוח כרגיל.",
        "days": days,
        "weeks": [{k: w[k] for k in
                   ("from", "to", "title", "body", "url", "cta", "collection", "percent")}
                  for w in WEEKS],
    }


if __name__ == "__main__":
    import json
    print(json.dumps(build(), ensure_ascii=False, indent=1))
