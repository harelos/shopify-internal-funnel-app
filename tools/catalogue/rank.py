"""Rank the harvested CJ pool down to a shortlist worth buying inventory decisions on.

The store sells to one woman covering grey roots at home, so the themes are
ordered around her: colour first, then the maintenance she already believes in,
then the adjacent scalp worry, then a thin skin-care shelf.
"""
import json, os, re, collections

HERE = os.path.dirname(os.path.abspath(__file__))
pool = json.load(open(os.path.join(HERE, "raw", "by_category.json"), encoding="utf-8"))
pool += json.load(open(os.path.join(HERE, "raw", "candidates.json"), encoding="utf-8"))
_deep = os.path.join(HERE, "raw", "hair_deep.json")
if os.path.exists(_deep) and os.path.getsize(_deep) > 1000:
    pool += json.load(open(_deep, encoding="utf-8"))

# one entry per pid; the category harvest wins because its metadata is richer
seen = {}
for p in pool:
    seen.setdefault(p.get("pid"), p)
pool = list(seen.values())

# theme -> (must-match tokens, weight). Order is the merchandising order.
THEMES = [
    ("dye",     ["hair dye", "hair color", "hair colour", "root touch", "grey hair", "gray hair",
                 "white hair", "hair mascara", "color cream", "dye shampoo", "dyeing", "colouring",
                 "hair coloring", "black hair shampoo", "hair chalk", "hair pen"]),
    ("care",    ["hair mask", "hair conditioner", "conditioner", "hair treatment", "hair serum",
                 "hair oil", "hair essence", "keratin", "argan", "hair care", "shampoo",
                 "hair cream", "hair spray", "hair repair", "smoothing", "frizz", "split end",
                 "leave-in", "leave in", "hair wax", "hair gel", "hair mousse", "hair milk"]),
    ("scalp",   ["hair growth", "hair loss", "scalp", "anti-hair", "regrowth", "biotin",
                 "rosemary oil", "ginger oil", "hair density", "thinning", "follicle",
                 "hair tonic", "hair ampoule"]),
    ("tool",    ["hair brush", "detangl", "comb", "hair cape", "hair towel", "turban",
                 "sectioning clip", "hair clip", "tint brush", "dye bowl", "dye brush",
                 "mixing bowl", "salon cape", "scalp massager", "hair claw", "heatless curl",
                 "satin pillowcase", "silk pillowcase", "shower cap", "hair steamer"]),
    ("skin",   ["hyaluronic", "niacinamide", "retinol", "vitamin c serum", "face serum",
                 "facial serum", "face cream", "eye cream", "face mask", "facial mask",
                 "collagen", "peptide", "sunscreen", "spf", "cleanser", "toner", "moistur",
                 "ampoule", "essence", "face oil", "lip mask", "body lotion", "body butter",
                 "hand cream", "body scrub"]),
]

# things that are not a finished beauty product for this shop
BAN = [
    "wig", "weave", "bundle", "lace front", "closure", "frontal", "ponytail", "extension",
    "braid", "cosplay", "eyelash", "lash", "nail", "manicure", "pedicure", "pet ", "dog ",
    "cat ", "car ", "shoe", "toilet", "sofa", "curtain", "mattress", "dress", "blazer",
    "jacket", "trouser", "lingerie", "bikini", "necklace", "earring", "bracelet", "ring ",
    "watch", "phone", "charger", "cable", "lamp", "light bulb", "flashlight", "toy",
    "sex ", "adult", "condom", "vape", "cigarette", "slimming", "weight loss", "breast",
    "penis", "tattoo", "piercing", "wax strip", "epilator", "hair removal", "depilat",
    "shaver", "razor", "trimmer", "clipper", "beard", "mustache", "denture", "teeth",
    "whitening strip", "tooth", "menstrual", "diaper", "baby ", "syringe", "needle",
    "mesotherapy", "derma pen", "microneedl", "tens ", "ear wax", "nose hair", "foot file",
    "callus", "corn remover", "vaginal", "anal", "yoni", "detox foot", "mole remover",
    "skin tag", "wart", "acne needle", "blackhead vacuum", "hair dryer", "straightener",
    "curling iron", "flat iron", "crimper",
]

# Anything mains- or battery-powered is wrong for this store: CJ ships type-A
# plugs and 110V units, Israel is type-H at 230V, and a device that arrives with
# the wrong plug becomes a return and a bad review.
POWERED = [
    "electric", "electrical", "lcd", "led", "usb", "charging", "rechargeable",
    "battery", "laser", "ultrasonic", "ionic", "negative ion", "infrared",
    "vibration", "vibrating", "apparatus", "instrument", "machine", "device",
    "massager", "steamer", "dryer", "straightening comb", "straight comb",
    "curling comb", "hot comb", "photon", "microcurrent", "rf ", "ems ",
    "vacuum", "suction", "sonic", "watt", "voltage", "plug", "cordless",
]

# Registered medicines and medical-device claims. Not ours to sell.
REGULATED = [
    "minoxidil", "finasteride", "ketoconazole", "hydroquinone", "tretinoin",
    "steroid", "antibiotic", "prescription", "pharmaceutical", "clinical grade",
    "laser therapy", "hair regrowth treatment", "fda approved", "medicine",
    "medicated", "drug",
]

PREMIUM_BAD = ["cheap", "wholesale", "factory", "oem", "odm", "bulk", "sample", "dropship"]


def low_price(p):
    try:
        return float(str(p.get("sellPrice", "")).split("--")[0].strip())
    except Exception:
        return -1.0


def theme_of(name):
    for t, toks in THEMES:
        for tok in toks:
            if tok in name:
                return t, tok
    return None, None


rows = []
for p in pool:
    name = (p.get("productNameEn") or "").lower().strip()
    if not name:
        continue
    if any(b in name for b in BAN):
        continue
    if any(b in name for b in POWERED):
        continue
    if any(b in name for b in REGULATED):
        continue
    theme, tok = theme_of(name)
    if not theme:
        continue
    listed = p.get("listedNum") or 0
    price = low_price(p)
    if price < 0.6 or price > 14:
        continue
    img = p.get("productImage") or ""
    if not img.startswith("http"):
        continue

    score = 0.0
    score += min(listed, 600) / 6.0                 # proven demand, capped
    if listed >= 200: score += 25
    elif listed >= 50: score += 15
    elif listed >= 25: score += 7
    if 1.2 <= price <= 7.0: score += 12             # the band that prices well in ILS
    if "_trans" in img: score += 8                  # CJ already cut the background
    if p.get("supplierName"): score += 6            # a named supplier is accountable
    if theme == "dye": score += 22                  # the store's actual traffic
    elif theme == "care": score += 14
    elif theme == "scalp": score += 8
    elif theme == "tool": score += 4
    if any(b in name for b in PREMIUM_BAD): score -= 20
    if len(name) > 95: score -= 6                   # keyword-stuffed listings look cheap

    rows.append({
        "pid": p.get("pid"), "sku": p.get("productSku"), "name": p.get("productNameEn"),
        "theme": theme, "token": tok, "listed": listed, "price": price,
        "sell": p.get("sellPrice"), "img": img, "cat": p.get("categoryName"),
        "supplier": p.get("supplierName"), "score": round(score, 1),
        "ship": p.get("shippingCountryCodes"),
    })

rows.sort(key=lambda r: -r["score"])

# collapse near-duplicate listings of the same physical product
def key(r):
    w = re.sub(r"[^a-z ]", " ", r["name"].lower()).split()
    stop = {"for","the","and","with","of","hair","new","hot","sale","pcs","ml","set","free","a","in","to"}
    w = [x for x in w if x not in stop and len(x) > 2]
    return " ".join(sorted(set(w))[:5])

dedup, kept = {}, []
for r in rows:
    k = key(r)
    if k in dedup:
        continue
    dedup[k] = 1
    kept.append(r)

json.dump(kept, open(os.path.join(HERE, "shortlist.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("pool %d -> passed %d -> deduped %d" % (len(pool), len(rows), len(kept)))
print()
c = collections.Counter(r["theme"] for r in kept)
print("by theme:", dict(c))
print()
for t, _ in THEMES:
    sub = [r for r in kept if r["theme"] == t][:14]
    print("=== %s ===" % t.upper())
    for r in sub:
        print("  %5.1f  listed=%-4d $%-6.2f %-62s %s" % (r["score"], r["listed"], r["price"], r["name"][:62], "TRANS" if "_trans" in r["img"] else ""))
    print()
