# -*- coding: utf-8 -*-
"""Re-cut the 66 live products into missions instead of product types.

The store's collections today answer "what is this thing" (hair-care, scalp-care,
hair-tools). A customer arrives with a problem, not a taxonomy, and the research
found that twenty of the hundred and twenty benchmark brands navigate by concern
while all three Israeli ones navigate by product type.

Nothing here writes to Shopify. It produces the mapping so the demo shows real
products at real prices, and so the collection rebuild later is a data change
rather than a judgement call made twice.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))

# handle prefixes and exact handles, in priority order: first match wins, so a
# colour shampoo lands in colour rather than in wash.
MISSIONS = [
    ("roots", "כיסוי שורשים וצבע בבית", "NovaHair",
     "הצבע נשאר, השורש חוזר. זה מה שמכסה אותו בבית.", [
         "novahair-fruit-color-cream", "novahair-root-touchup-spray",
         "novahair-black-color-shampoo", "novahair-botanical-color-shampoo",
         "novahair-ash-tone-shampoo", "novahair-darkening-shampoo-bar",
         "novahair-coloring-kit", "hairline-powder-instantly-conceals",
     ]),
    ("scalp", "שיער דליל וקרקפת", "NovaHair",
     "מתחיל בקרקפת. סרומים, שמנים ותרסיסים לשורש.", [
         "novahair-scalp-serum", "novahair-growth-serum", "novahair-density-serum",
         "novahair-root-lotion", "novahair-scalp-ampoules",
         "novahair-ginger-scalp-spray", "novahair-oily-scalp-spray",
         "novahair-ginseng-spray", "novahair-rosemary-oil",
         "novahair-ginger-root-oil", "novahair-ginger-scalp-oil",
         "novahair-onion-blackseed-oil", "novahair-neem-oil",
         "biotinroot-hair-loss-spray", "שמפו-לצמיחת-שיער-מחודש",
         "advancedcopperserum",
     ]),
    ("repair", "שיקום, לחות וברק", "NovaHair",
     "לשיער שעבר צביעה, שמש ומגהץ. חפיפה, מסכה, שמן.", [
         "novahair-keratin-mask", "novahair-shea-mask", "novahair-hyaluronic-mask",
         "novahair-argan-oil", "novahair-coconut-oil", "novahair-olive-oil",
         "novahair-smoothing-oil", "novahair-batana-oil-50", "novahair-batana-oil-120",
         "novahair-rosemary-duo", "novahair-botanic-shampoo",
         "novahair-keratin-shampoo", "novahair-peptide-shampoo",
         "novahair-strengthening-shampoo", "novahair-activating-shampoo",
         "novahair-daily-shampoo", "novahair-no-heat-cream",
         "novahair-rice-water-spray", "novahair-styling-pomade",
         "ספריי-היירגלוס-לשיער", "מסכת-שיקום-והזנה-לשיער-עם-שמן-ארגן",
         "סרום-קרטין-לשיער-חלק-רך-ומבריק", "שמן-קיק-שחור",
     ]),
    ("tools", "כלים ואביזרים", "NovaHair",
     "בלי חשמל. מה שמונע את הבלגן על הכיור.", [
         "novahair-self-cleaning-brush", "novahair-volume-brush",
         "novahair-heatless-curler", "novahair-scalp-massager",
         "novahair-comb-set",
     ]),
    ("night", "מסכות לילה", "NovaGlow",
     "המוצר הכי נמכר בהיסטוריה של החנות, ומה שנבנה סביבו.", [
         "מסיכת-קולגן-לילה-elasticdream",
         "ערכת-טיפוח-זהב-משולשת-מסיכת-קולגן-",
     ]),
    ("serums", "סרומים ולחות", "NovaGlow",
     "היאלורוני, פפטידים, חומצות. לפי בעיה ולא לפי מותג.", [
         "סרום-חומצה-הילוארנית-4-ב-1", "novaglow-pdrn-serum",
         "novaglow-copper-peptide-serum", "novaglow-azelaic-acid-10",
         "novaglow-rose-gold-face-oil", "novaglow-eye-stick",
     ]),
    ("body", "גוף וידיים", "NovaGlow",
     "הפריטים הקטנים שנכנסים לסל ליד המסכה.", [
         "novaglow-avocado-hand-cream", "novaglow-matcha-body-scrub",
         "novaglow-citrus-body-scrub",
     ]),
    ("protect", "הגנה יומיומית", "NovaGlow",
     "השלב שבא אחרי הסרום, לפני שיוצאים מהבית.", [
         "novaglow-daily-sunscreen-50", "novaglow-primer-sunscreen",
         "novaglow-hyaluronic-sun-gel",
     ]),
]




def run():
    prods = {p["handle"]: p for p in
             json.load(open(os.path.join(HERE, "active.json"), encoding="utf-8"))}
    placed, out = set(), []

    for key, title, brand, line, handles in MISSIONS:
        items = []
        for h in handles:
            # the legacy Hebrew handles are truncated in places, so match on prefix
            p = prods.get(h) or next(
                (v for k, v in prods.items() if k.startswith(h)), None)
            if not p:
                print("  MISSING %s" % h)
                continue
            if p["handle"] in placed:
                continue
            placed.add(p["handle"])
            items.append({"handle": p["handle"], "title": p["title"],
                          "price": p["price"], "img": p["img"]})
        items.sort(key=lambda r: -(r["price"] or 0))
        out.append({"key": key, "title": title, "brand": brand,
                    "line": line, "count": len(items), "items": items})
        print("%-8s %-26s %-9s %2d products   ₪%d–₪%d"
              % (key, title, brand, len(items),
                 min(i["price"] for i in items), max(i["price"] for i in items)))

    left = [h for h in prods if h not in placed]
    print("placed %d of %d" % (len(placed), len(prods)))
    if left:
        print("unplaced:")
        for h in left:
            print("   %s" % h)

    json.dump(out, open(os.path.join(HERE, "missions.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    run()
