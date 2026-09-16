# -*- coding: utf-8 -*-
"""Rank the skincare harvest. Beauty only, and nothing the store already sells.

The scope rule here is not a preference, it is a boundary Harel set: this is a
beauty store, not a clothing or accessories store. So a product qualifies only
if it is something applied to skin, or a tool for applying it. A scarf, a hair
clip, a scrunchie and a comb all fail that test regardless of how many
merchants list them, and they are not in this file's world at all.

The harder filter is repetition. The store already sells 66 products and the
first import shipped a fourth argan oil because the filter matched product
handles rather than substances. So ALREADY matches the *substance* and the
*object*: any serum whose active is one the store already stocks is out, even
under a new brand name and a new bottle.
"""
import collections, io, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))

# what the store already sells, by substance and object rather than by name
ALREADY = (
    r"argan|rosemary|ginger|batana|castor|coconut|amla|biotin|keratin|hyaluron|"
    r"onion|black seed|neem|ginseng|olive oil|shea|"
    r"hair growth|anti.?hair.?loss|hair loss|regrowth|density|follicle|"
    r"scalp serum|scalp massager|scalp spray|scalp oil|hair mask|"
    r"shampoo bar|purple shampoo|color shampoo|dye shampoo|hair dye|hair color|"
    r"root touch|hairline powder|coloring kit|tint brush|"
    r"pdrn|copper peptide|azelaic|retinol|niacinamide|vitamin c serum|"
    r"collagen mask|night mask|eye stick|body scrub|hand cream")

# Israel's notification track, plus claims this store will not make
REGULATED = (
    r"sunscreen|\bspf\b|uv protect|sun block|sunblock|tanning|self.?tan|"
    r"whitening|bleach|freckle removal|melasma|"
    r"minoxidil|hydroquinone|\bbaby\b|infant|newborn|toddler|"
    r"medicine|medical|pharma|\bdrug\b|prescription|injection|needle|"
    r"slimming|weight loss|breast enlarge|lifting machine|"
    r"muscle ton|abdominal|abs stimulator|\bems\b")

POWERED = (
    r"electric|rechargeable|\busb\b|battery|cordless|heated|heating|"
    r"laser|\bled\b|ultrasonic|vibrat|microcurrent|radio frequency|\brf\b|"
    r"steamer|photon|galvanic")

# CJ matched the query text somewhere in a listing that is not a beauty product
NOT_BEAUTY = (
    r"\bpets?\b|\bdogs?\b|\bcats?\b|grooming|"
    r"\bphone\b|\bcase\b|keychain|\bcar\b|kitchen|microwave|"
    r"\bdress\b|\bshirt\b|\bhat\b|\bbag\b|handbag|\bshoes?\b|\bsocks?\b|"
    r"halloween|cosplay|costume|\btoy\b|\bdoll\b|"
    r"welding|respirator|\bkn95\b|\bkf ?94\b|dust mask|gas mask|"
    r"mattress|pillow|blanket|curtain|\btable\b|"
    r"jacket|trousers|blazer|\bcoat\b|t.?shirt|heels|\bsuit\b|"
    # each of these reached a skincare shelf on a single word: "toner" inside
    # boxer shorts, "toning" inside a stepper machine, "patch" inside patchwork
    r"boxer|underwear|panties|briefs|one.?piece set|patchwork|"
    r"stepper|treadmill|fitness|exercise machine|"
    r"\bnail\b|sweatpants|leggings|embroider|\bsocks\b|"
    # a five-product bundle at $91 is not a product decision, it is someone
    # else's catalogue; and CJ files salon hardware under the same words as a
    # hand-held stone
    r"5.?step|full set kit|\bequipment\b|\binstrument\b|"
    # makeup is a different shelf and a different returns profile from skincare
    r"foundation|concealer|lip gloss|lipstick|mascara|eyeshadow|\bblush\b")

# a beauty product names what it is. shelf -> the nouns that belong on it.
REQUIRE = {
    "מסכות": r"mask|patch|pack\b|sheet",
    "ניקוי": r"cleans|face wash|foam|remover|micellar|balm|oil\b",
    "טונר ומיסט": r"toner|tonic|mist|spray|essence|softener|pad\b",
    "סרום ואמפולה": r"serum|essence|ampoule|booster|concentrate|elixir",
    "עיניים": r"eye",
    "לחות": r"cream|moistur|lotion|gel|emulsion|balm",
    "שפתיים": r"lip",
    "פצעונים": r"patch|acne|pimple|blemish|spot",
    "כלים": r"gua ?sha|roller|massag|brush|cupping|scraper|spatula",
    "פילינג": r"scrub|exfolia|peel|pore|blackhead",
    "גוף וידיים": r"lotion|butter|cream|mask|balm",
}

SHELF = {
    "sheet-mask": "מסכות", "wash-mask": "מסכות",
    "cleanser": "ניקוי", "toner": "טונר ומיסט", "serum": "סרום ואמפולה",
    "eye": "עיניים", "moisture": "לחות", "lip": "שפתיים",
    "blemish": "פצעונים", "face-tool": "כלים", "exfoliate": "פילינג",
    "body-care": "גוף וידיים",
}


def run():
    rows = json.load(io.open(os.path.join(HERE, "raw5", "harvest5.json"), encoding="utf-8"))
    for r in rows:
        r["shelf"] = SHELF.get(r["concept"], r["concept"])
    print("harvested                %5d" % len(rows))

    for label, pat in (("already sold by this store", ALREADY),
                       ("regulated or a claim we avoid", REGULATED),
                       ("powered, wrong voltage", POWERED),
                       ("matched a word, is not beauty", NOT_BEAUTY)):
        gone = [r for r in rows if re.search(pat, r["name"] or "", re.I)]
        rows = [r for r in rows if not re.search(pat, r["name"] or "", re.I)]
        print("  -%-5d %-34s -> %5d left" % (len(gone), label, len(rows)))

    before = len(rows)
    rows = [r for r in rows if re.search(REQUIRE[r["shelf"]], r["name"] or "", re.I)]
    print("  -%-5d %-34s -> %5d left"
          % (before - len(rows), "does not name its own category", len(rows)))

    for bar in (200, 100, 50, 25):
        print("  listed >= %-4d %5d" % (bar, sum(1 for r in rows if r["listed"] >= bar)))

    strong = sorted([r for r in rows if r["listed"] >= 25], key=lambda r: -r["listed"])
    print("\nby shelf, at listed >= 25:")
    for k, v in collections.Counter(r["shelf"] for r in strong).most_common():
        print("  %-14s %4d" % (k, v))

    json.dump(strong, io.open(os.path.join(HERE, "raw5", "strong5.json"), "w",
                              encoding="utf-8"), ensure_ascii=False)

    print("\ntop 40:")
    for r in strong[:40]:
        print("  %5d $%-8s %-14s %s" % (r["listed"], str(r["price"])[:8], r["shelf"],
                                        (r["name"] or "")[:56]))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    run()
