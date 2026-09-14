# -*- coding: utf-8 -*-
"""Write the rebuilt copy onto the 55 products.

Per product this sets the description, the SEO pair, the tags, and the
metafields the PDP renders: promise, chips, ingredients, mechanism, steps,
timeline, fit and FAQ. It also sets the companion products shown under the
add-to-cart button.

Run with --check to validate without touching Shopify.
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from deck_hair import HAIR
from deck_oils import OILS
from deck_wash import WASH
from deck_rest import REST
from ingredients import ING

DECKS = HAIR + OILS + WASH + REST

# Companions shown under the button. Merchandising, not an algorithm: a woman
# buying colour needs the maintenance that protects it, and a woman buying a
# treatment needs the thing she uses it with. Two or three, which is what the
# leading beauty PDPs actually show in that slot.
PAIRS = {
  # colour buys maintenance
  "novahair-fruit-color-cream":       ["novahair-coloring-kit", "novahair-botanic-shampoo", "novahair-keratin-mask"],
  "novahair-root-touchup-spray":      ["novahair-fruit-color-cream", "novahair-botanic-shampoo"],
  "novahair-black-color-shampoo":     ["novahair-botanic-shampoo", "novahair-keratin-mask", "novahair-argan-oil"],
  "novahair-botanical-color-shampoo": ["novahair-scalp-serum", "novahair-hyaluronic-mask"],
  "novahair-ash-tone-shampoo":        ["novahair-hyaluronic-mask", "novahair-argan-oil"],
  "novahair-darkening-shampoo-bar":   ["novahair-scalp-massager", "novahair-rosemary-oil"],
  "novahair-coloring-kit":            ["novahair-fruit-color-cream", "novahair-comb-set"],
  # oils pair with the wash that precedes them
  "novahair-argan-oil":               ["novahair-keratin-mask", "novahair-daily-shampoo"],
  "novahair-smoothing-oil":           ["novahair-no-heat-cream", "novahair-volume-brush"],
  "novahair-coconut-oil":             ["novahair-shea-mask", "novahair-scalp-massager"],
  "novahair-batana-oil-50":           ["novahair-keratin-shampoo", "novahair-keratin-mask"],
  "novahair-batana-oil-120":          ["novahair-keratin-shampoo", "novahair-scalp-massager"],
  "novahair-olive-oil":               ["novaglow-citrus-body-scrub", "novahair-comb-set"],
  "novahair-rosemary-oil":            ["novahair-scalp-massager", "novahair-botanic-shampoo"],
  "novahair-ginger-root-oil":         ["novahair-scalp-massager", "novahair-peptide-shampoo"],
  "novahair-onion-blackseed-oil":     ["novahair-peptide-shampoo", "novahair-scalp-massager"],
  "novahair-density-serum":           ["novahair-peptide-shampoo", "novahair-scalp-massager"],
  "novahair-root-lotion":             ["novahair-peptide-shampoo", "novahair-growth-serum"],
  "novahair-styling-pomade":          ["novahair-comb-set", "novahair-daily-shampoo"],
  # wash pairs with treatment
  "novahair-daily-shampoo":           ["novahair-hyaluronic-mask", "novahair-argan-oil"],
  "novahair-strengthening-shampoo":   ["novahair-keratin-mask", "novahair-scalp-serum"],
  "novahair-botanic-shampoo":         ["novahair-hyaluronic-mask", "novahair-rosemary-oil"],
  "novahair-keratin-shampoo":         ["novahair-keratin-mask", "novahair-batana-oil-50"],
  "novahair-peptide-shampoo":         ["novahair-growth-serum", "novahair-scalp-massager"],
  "novahair-activating-shampoo":      ["novahair-volume-brush", "novahair-scalp-serum"],
  "novahair-rosemary-duo":            ["novahair-rosemary-oil", "novahair-scalp-massager"],
  "novahair-scalp-serum":             ["novahair-scalp-massager", "novahair-peptide-shampoo"],
  # masks pair with the shampoo that precedes them
  "novahair-keratin-mask":            ["novahair-keratin-shampoo", "novahair-argan-oil"],
  "novahair-shea-mask":               ["novahair-coconut-oil", "novahair-comb-set"],
  "novahair-hyaluronic-mask":         ["novahair-daily-shampoo", "novahair-smoothing-oil"],
  "novahair-no-heat-cream":           ["novahair-smoothing-oil", "novahair-heatless-curler"],
  "novahair-rice-water-spray":        ["novahair-comb-set", "novahair-argan-oil"],
  "novahair-ginger-scalp-spray":      ["novahair-scalp-massager", "novahair-peptide-shampoo"],
  "novahair-oily-scalp-spray":        ["novahair-activating-shampoo", "novahair-scalp-massager"],
  # scalp line
  "novahair-growth-serum":            ["novahair-peptide-shampoo", "novahair-scalp-massager"],
  "novahair-scalp-ampoules":          ["novahair-growth-serum", "novahair-peptide-shampoo"],
  "novahair-ginger-scalp-oil":        ["novahair-scalp-massager", "novahair-botanic-shampoo"],
  "novahair-ginseng-spray":           ["novahair-growth-serum", "novahair-peptide-shampoo"],
  "novahair-neem-oil":                ["novahair-scalp-massager", "novahair-scalp-serum"],
  # tools pair with what they are used on
  "novahair-self-cleaning-brush":     ["novahair-rice-water-spray", "novahair-argan-oil"],
  "novahair-volume-brush":            ["novahair-activating-shampoo", "novahair-smoothing-oil"],
  "novahair-heatless-curler":         ["novahair-no-heat-cream", "novahair-argan-oil"],
  "novahair-scalp-massager":          ["novahair-rosemary-oil", "novahair-peptide-shampoo"],
  "novahair-comb-set":                ["novahair-rice-water-spray", "novahair-coloring-kit"],
  # skin stays inside its own shelf
  "novaglow-copper-peptide-serum":    ["novaglow-daily-sunscreen-50", "novaglow-eye-stick"],
  "novaglow-pdrn-serum":              ["novaglow-hyaluronic-sun-gel", "novaglow-eye-stick"],
  "novaglow-azelaic-acid-10":         ["novaglow-daily-sunscreen-50", "novaglow-pdrn-serum"],
  "novaglow-rose-gold-face-oil":      ["novaglow-primer-sunscreen", "novaglow-eye-stick"],
  "novaglow-eye-stick":               ["novaglow-copper-peptide-serum", "novaglow-daily-sunscreen-50"],
  "novaglow-hyaluronic-sun-gel":      ["novaglow-pdrn-serum", "novaglow-avocado-hand-cream"],
  "novaglow-daily-sunscreen-50":      ["novaglow-copper-peptide-serum", "novaglow-eye-stick"],
  "novaglow-primer-sunscreen":        ["novaglow-rose-gold-face-oil", "novaglow-eye-stick"],
  "novaglow-avocado-hand-cream":      ["novaglow-citrus-body-scrub", "novaglow-matcha-body-scrub"],
  "novaglow-matcha-body-scrub":       ["novaglow-avocado-hand-cream", "novaglow-citrus-body-scrub"],
  "novaglow-citrus-body-scrub":       ["novaglow-avocado-hand-cream", "novaglow-daily-sunscreen-50"],
}

EM, EN = "—", "–"


def ing_for(d):
    return d.get("ing", ING.get(d["h"], []))


def description(d):
    """The page body: lead, then the rest. Everything else lives in metafields."""
    return d["lead"] + d.get("body", "")


def check():
    pub = json.load(open(os.path.join(HERE, "published.json"), encoding="utf-8"))
    live = {v["handle"] for v in pub.values()}
    problems, seen = [], set()

    for d in DECKS:
        h = d["h"]
        tag = h
        if h in seen:
            problems.append("%s: duplicate deck" % tag)
        seen.add(h)
        if h not in live:
            problems.append("%s: no such product" % tag)

        for field in ("promise", "seo_t", "seo_d"):
            if EM in d[field] or EN in d[field]:
                problems.append("%s: dash in %s" % (tag, field))
        blob = " ".join(d["chips"] + d["steps"] + d["expect"] + d["yes"] + d["no"] + d["faq"])
        blob += d["lead"] + d.get("body", "") + d["mech"] + " ".join(ing_for(d))
        if EM in blob or EN in blob:
            problems.append("%s: dash somewhere in the deck" % tag)

        if len(d["promise"]) > 46:
            problems.append("%s: promise %d chars, too long for the subhead" % (tag, len(d["promise"])))
        if len(d["chips"]) != 3:
            problems.append("%s: %d chips, want 3" % (tag, len(d["chips"])))
        if len(d["seo_t"]) > 70:
            problems.append("%s: seo title %d chars" % (tag, len(d["seo_t"])))
        if not (70 <= len(d["seo_d"]) <= 165):
            problems.append("%s: seo description %d chars" % (tag, len(d["seo_d"])))
        for key in ("steps", "expect", "faq", "mech"):
            for entry in ([d[key]] if key == "mech" else d[key]):
                if "|" not in entry:
                    problems.append("%s: %s entry missing the | separator" % (tag, key))
        for entry in ing_for(d):
            if "|" not in entry:
                problems.append("%s: ingredient missing the | separator" % tag)
        if len(d["faq"]) < 3:
            problems.append("%s: only %d FAQ entries" % (tag, len(d["faq"])))
        if len(d["no"]) < 2:
            problems.append("%s: needs at least two honest 'not for you' lines" % tag)

        for comp in PAIRS.get(h, []):
            if comp not in live:
                problems.append("%s: pairs with '%s' which does not exist" % (tag, comp))
            if comp == h:
                problems.append("%s: pairs with itself" % tag)

    missing = sorted(live - seen)
    print("decks: %d, live products: %d" % (len(DECKS), len(live)))
    if missing:
        problems.append("no deck for: %s" % ", ".join(missing))
    no_pairs = sorted(h for h in seen if not PAIRS.get(h))
    if no_pairs:
        problems.append("no companions for: %s" % ", ".join(no_pairs))

    if problems:
        print("\nPROBLEMS (%d):" % len(problems))
        for p in problems:
            print("  " + p)
    else:
        print("no problems found")
    return problems


MF = """
mutation mf($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) { userErrors { field message } }
}"""

PROD = """
mutation up($product: ProductUpdateInput!) {
  productUpdate(product: $product) {
    product { id handle }
    userErrors { field message }
  }
}"""


def deploy():
    import shopify
    pub = json.load(open(os.path.join(HERE, "published.json"), encoding="utf-8"))
    by_handle = {v["handle"]: v["gid"] for v in pub.values()}

    for d in DECKS:
        gid = by_handle[d["h"]]

        r = shopify.gql(PROD, {"product": {
            "id": gid,
            "descriptionHtml": description(d),
            "seo": {"title": d["seo_t"], "description": d["seo_d"]},
            "tags": d["kw"] + ["ייבוא ספטמבר"],
        }})["productUpdate"]
        if r["userErrors"]:
            print("  FAILED %-34s %s" % (d["h"], r["userErrors"]))
            continue

        fields = [
            ("subtitle", "single_line_text_field", d["promise"]),
            ("chips", "list.single_line_text_field", json.dumps(d["chips"], ensure_ascii=False)),
            ("mechanism", "multi_line_text_field", d["mech"]),
            ("steps_title", "single_line_text_field", d["steps_title"]),
            ("steps", "list.single_line_text_field", json.dumps(d["steps"], ensure_ascii=False)),
            ("expect", "list.single_line_text_field", json.dumps(d["expect"], ensure_ascii=False)),
            ("fit_yes", "list.single_line_text_field", json.dumps(d["yes"], ensure_ascii=False)),
            ("fit_no", "list.single_line_text_field", json.dumps(d["no"], ensure_ascii=False)),
            ("faq", "list.single_line_text_field", json.dumps(d["faq"], ensure_ascii=False)),
        ]
        ings = ing_for(d)
        if ings:
            fields.append(("ingredients", "list.single_line_text_field",
                           json.dumps(ings, ensure_ascii=False)))
        comps = PAIRS.get(d["h"], [])
        if comps:
            fields.append(("pairs", "list.single_line_text_field",
                           json.dumps(comps, ensure_ascii=False)))

        payload = [{"ownerId": gid, "namespace": "nova", "key": k, "type": t, "value": v}
                   for k, t, v in fields]
        e = shopify.gql(MF, {"metafields": payload})["metafieldsSet"]["userErrors"]
        if e:
            print("  MF FAIL %-33s %s" % (d["h"], e))
            continue
        print("  ok %-34s %d fields" % (d["h"], len(fields)))
        sys.stdout.flush()

    print("\ndone: %d products" % len(DECKS))


if __name__ == "__main__":
    if "--check" in sys.argv:
        sys.exit(1 if check() else 0)
    deploy()
