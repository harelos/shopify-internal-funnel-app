# -*- coding: utf-8 -*-
"""Rank the second harvest and pick 50 that do not repeat what the store sells.

Three filters, in this order, and each one exists because of something the first
import got wrong or nearly got wrong:

1. NOT ALREADY SOLD. The first pass shipped a fourth argan oil and a third
   rosemary oil because the filter matched handles, not substances. This one
   matches the substance and the object, against the 66 products live today.

2. NOT REGULATED. Israel's 2025 Notification Track does not cover sunscreen,
   and lice treatment is a pesticide claim, not a cosmetic one. Tools and
   accessories carry none of that burden, which is most of why this vein is
   worth mining.

3. NOT POWERED. CJ ships type-A at 110V. Israel is type-H at 230V. An electric
   lice comb is a returns queue with a plug on it.

What survives is sorted by CJ's own listedNum, which is the only demand signal
in the data that was not supplied by me: it counts how many other merchants
chose to list that product.
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw2", "harvest2.json")

# what the store already sells, by substance and by object rather than by name
ALREADY = (
    r"argan|rosemary|ginger|batana|castor|coconut|amla|biotin|keratin|hyaluron|"
    r"onion|black seed|neem|ginseng|olive oil|shea|"
    r"hair growth|anti.?hair.?loss|hair loss|regrowth|density|follicle|"
    r"scalp serum|scalp massager|scalp spray|scalp oil|hair mask|"
    r"shampoo bar|purple shampoo|color shampoo|dye shampoo|hair dye|hair color(?!ing book)|"
    r"root touch|hairline powder|coloring kit|tint brush|"
    r"pdrn|copper peptide|azelaic|retinol|niacinamide|vitamin c serum|"
    r"collagen mask|night mask|eye stick|body scrub|hand cream"
)

REGULATED = (
    r"sunscreen|spf|uv protect|sun block|tanning|self.?tan|whitening|bleach|"
    r"lice (?:treatment|spray|shampoo|lotion|killer)|anti.?lice (?:spray|shampoo)|"
    r"pesticide|permethrin|minoxidil|baby|infant|newborn|toddler|"
    r"medicine|medical|pharma|drug|treatment for"
)

POWERED = (
    r"electric|rechargeable|usb|battery|cordless|heated|heating|hot air|"
    r"blow dry|hair dryer|straightener iron|curling iron|steamer|"
    r"laser|led (?:light|therapy|comb)|ultrasonic|vibrat"
)

# things that are technically hair but are costume, novelty or resale stock
NOISE = (
    r"halloween|cosplay|costume|party wig|clown|anime|doll|mannequin head|"
    r"training head|wholesale bundle|human hair bundle|weave bundle|"
    r"closure|frontal|virgin hair|raw hair|hair extension tape|keratin bond"
)

SHELVES = {
    "wig":   "טיפוח פאה",
    "night": "הגנת לילה",
    "curl":  "תלתלים",
    "lice":  "מסרקי כינים",
    "piece": "נפח ותוספות",
    "cover": "כיסוי ראש",
    "men":   "גברים",
    "kids":  "ילדים",
}


def drop(name, pat):
    return re.search(pat, name, re.I) is not None


def run():
    rows = json.load(open(RAW, encoding="utf-8"))
    print("harvested            %5d" % len(rows))

    steps = []
    cur = rows
    for label, pat in (("already sold by this store", ALREADY),
                       ("regulated or sensitive", REGULATED),
                       ("powered, wrong voltage", POWERED),
                       ("costume, novelty or resale stock", NOISE)):
        gone = [r for r in cur if drop(r["name"] or "", pat)]
        cur = [r for r in cur if not drop(r["name"] or "", pat)]
        steps.append((label, len(gone), len(cur)))
        print("  -%-5d %-36s -> %5d left" % (len(gone), label, len(cur)))

    # CJ's own listing count is the only demand signal here I did not author
    for bar in (200, 100, 50, 25):
        n = len([r for r in cur if (r.get("listed") or 0) >= bar])
        print("  listed >= %-4d %5d" % (bar, n))

    strong = sorted([r for r in cur if (r.get("listed") or 0) >= 50],
                    key=lambda r: -(r.get("listed") or 0))
    print("\nby shelf, at listed >= 50:")
    import collections
    c = collections.Counter(r["theme"] for r in strong)
    for k, v in c.most_common():
        print("  %-7s %-16s %4d" % (k, SHELVES.get(k, k), v))

    json.dump(strong, open(os.path.join(HERE, "raw2", "strong2.json"), "w",
                           encoding="utf-8"), ensure_ascii=False)
    print("\ntop 40 candidates:")
    for r in strong[:40]:
        print("  %5d  $%-6.2f %-7s %s"
              % (r["listed"], float(r["price"] or 0), r["theme"], (r["name"] or "")[:62]))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    run()
