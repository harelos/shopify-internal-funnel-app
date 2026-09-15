# -*- coding: utf-8 -*-
"""Turn the promotion calendar into the spec for the thirteen email heroes.

Prices come from the live variant price and the day's real discount, so the
number on the image is the number the customer pays. Nothing here is typed by
hand twice.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import shopify
from promo_calendar import DAYS

# a short name for the image, where the full product title is too long
SHORT = {
    "novahair-fruit-color-cream": "קרם צבע עם מסרק",
    "novahair-black-color-shampoo": "שמפו צבע שחור",
    "novahair-botanical-color-shampoo": "שמפו צבע צמחי",
    "novahair-root-touchup-spray": "ספריי כיסוי שורשים",
    "novahair-argan-oil": "שמן ארגן",
    "novahair-botanic-shampoo": "שמפו צמחי מחזק",
    "novahair-hyaluronic-mask": "מסכה היאלורונית",
    "novahair-daily-shampoo": "שמפו יומיומי",
    "novahair-growth-serum": "סרום צמיחה",
    "novahair-scalp-serum": "סרום לקרקפת",
    "novahair-scalp-massager": "מברשת עיסוי",
    "novahair-coloring-kit": "ערכת צביעה",
    "novahair-rosemary-oil": "שמן רוזמרין",
    "novahair-batana-oil-50": "שמן בטאנה",
    "novahair-coconut-oil": "שמן קוקוס",
    "novaglow-matcha-body-scrub": "פילינג מאצ'ה",
    "novaglow-pdrn-serum": "סרום PDRN",
    "novaglow-copper-peptide-serum": "פפטידי נחושת",
    "novaglow-azelaic-acid-10": "חומצה אזלאית",
    "novahair-batana-oil-120": "שמן בטאנה 120",
    "novahair-keratin-shampoo": "שמפו קרטין",
    "novahair-keratin-mask": "מסכת קרטין",
}

# the line under the headline, one per day, in the voice of the emails
SUB = {
    "2026-09-16": ["שלוש דרכים לכסות שיער לבן בבית"],
    "2026-09-17": ["לקצוות שספגו את כל הצביעות של השנה"],
    "2026-09-18": ["שמפו, מסכה ושמן. שלושת השלבים"],
    "2026-09-19": ["לימים שבהם החפיפה רק צריכה לנקות"],
    "2026-09-22": ["אחרי הצום, הקרקפת הראשונה שמרגישה"],
    "2026-09-23": ["בלי קערה, בלי מברשת, בלי כפפות"],
    "2026-09-24": ["הצבע, הכלים והשמפו שישמור עליו"],
    "2026-09-25": ["הכלים שמונעים את הבלגן על הכיור"],
    "2026-09-26": ["קרקפת, אורך וקצוות. שלוש עבודות"],
    "2026-09-27": ["על עור לח, לא מתחת לזרם"],
    "2026-09-28": ["שלושה סרומים, שלוש בעיות שונות"],
    "2026-09-29": ["טיפול שבועי לשיער שעבר יותר מדי"],
    "2026-09-30": ["היום האחרון. הסט המלא לשיער פגום"],
}

Q = """
query p($q: String!) {
  products(first: 1, query: $q) {
    nodes {
      handle title
      variants(first: 1) { nodes { price } }
      media(first: 1) { nodes { ... on MediaImage { image { url } } } }
    }
  }
}"""


def price_of(handle):
    n = shopify.gql(Q, {"q": "handle:%s" % handle})["products"]["nodes"]
    return float(n[0]["variants"]["nodes"][0]["price"]) if n else None


def wrap(s, n=22):
    """Break a headline into lines short enough to sit beside a product."""
    words, lines, cur = s.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if len(t) <= n:
            cur = t
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines[:3]


def run():
    tiles = {r["handle"]: r for r in
             json.load(open(os.path.join(HERE, "tiles2.json"), encoding="utf-8"))}
    spec = []
    for date, kind, off, headline, line, handles in DAYS:
        if kind == "dark":
            continue
        items = []
        for h in handles:
            p = price_of(h)
            t = tiles.get(h)
            if p is None or not t:
                print("  skip %s (no price or tile)" % h)
                continue
            items.append({
                "handle": h,
                "name": SHORT.get(h, h),
                "tile": t["tile2"],
                "was": p,
                "now": round(p * (100 - off) / 100.0, 2),
            })
        if not items:
            continue

        label = {"product": "המבצע של היום", "theme": "הנושא של היום",
                 "bundle": "השגרה של היום"}[kind]
        row = {
            "slug": date,
            "kind": "single" if len(items) == 1 else "trio",
            "eyebrow": "%s · %s" % (label, date[8:10] + "." + date[5:7]),
            "headline": wrap(headline) if len(items) == 1 else [headline],
            "sub": SUB.get(date, []),
            "items": items,
            "cta": "%d%% היום" % off,
            "kind_label": kind,
        }
        if len(items) == 1:
            row["tile"] = items[0]["tile"]
            row["was"] = items[0]["was"]
            row["now"] = items[0]["now"]
        spec.append(row)

    json.dump(spec, open(os.path.join(HERE, "email_spec.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print("spec: %d days" % len(spec))
    return spec


if __name__ == "__main__":
    run()
