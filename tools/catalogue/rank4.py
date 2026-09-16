# -*- coding: utf-8 -*-
"""Merge every demand-led harvest and rank what is actually buyable.

Three harvests feed this: the demand-led sweep (one phrasing per concept), the
head-covering sweep, and the synonym-expanded sweep that exists because asking
CJ the same question in six ways returns six different shelves.

Two filters were added here that the earlier ranker did not have, both because
the head-covering results demanded them:

APPAREL. The single highest-listed result in the head-covering harvest was a
Moroccan kaftan with 1,030 merchants behind it. CJ files garments and scarves
in the same bucket because the sellers tag them together. A kaftan is a real
product with real demand and it is not a product this store can sell, so it
leaves before ranking rather than eating a slot in the top 50.

RELIGIOUS FRAMING. A plain 70x180 chiffon scarf is the same physical object an
Israeli woman searches for as מטפחת ראש. But a listing whose photograph is a
styled hijab, and whose title says Ramadan or Islamic or Eid, carries framing
this store cannot use, and the image is most of what gets imported. So the
object passes and the framing is flagged, per row, for a human to look at.
"""
import collections, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))

SOURCES = [("raw2/harvest2.json", "theme"),
           ("raw3/harvest3.json", "theme"),
           ("raw4/harvest4.json", "concept")]

ALREADY = (
    r"argan|rosemary|ginger|batana|castor|coconut|amla|biotin|keratin|hyaluron|"
    r"onion|black seed|neem|ginseng|olive oil|shea|"
    r"hair growth|anti.?hair.?loss|hair loss|regrowth|density|follicle|"
    r"scalp serum|scalp massager|scalp spray|scalp oil|hair mask|"
    r"shampoo bar|purple shampoo|color shampoo|dye shampoo|hair dye|hair color(?!ing book)|"
    r"root touch|hairline powder|coloring kit|tint brush|"
    r"pdrn|copper peptide|azelaic|retinol|niacinamide|vitamin c serum|"
    r"collagen mask|night mask|eye stick|body scrub|hand cream")

REGULATED = (
    r"sunscreen|spf|uv protect|sun block|tanning|self.?tan|whitening|bleach|"
    r"lice (?:treatment|spray|shampoo|lotion|killer)|anti.?lice (?:spray|shampoo)|"
    r"pesticide|permethrin|minoxidil|baby|infant|newborn|toddler|"
    r"medicine|medical|pharma|drug|treatment for")

POWERED = (
    r"electric|rechargeable|usb|battery|cordless|heated|heating|hot air|"
    r"blow dry|hair dryer|straightener iron|curling iron|steamer|"
    r"laser|led (?:light|therapy|comb)|ultrasonic|vibrat")

NOISE = (
    r"halloween|cosplay|costume|party wig|clown|anime|doll|mannequin head|"
    r"training head|wholesale bundle|human hair bundle|weave bundle|"
    r"closure|frontal|virgin hair|raw hair|hair extension tape|keratin bond|"
    r"phone case|basketball|jersey embroidery|fishing|sailing")

# garments. CJ tags a kaftan and a scarf with the same words; we sell neither
# dresses nor abayas, and they would otherwise dominate the ranking.
APPAREL = (
    r"\babaya\b|\bkaftan\b|\bcaftan\b|\bkimono\b|cardigan|\bdress(?:es)?\b|"
    r"\brobe\b|\bjilbab\b|\bgown\b|two.?piece|\bsets?\b jalabiya|jalabiya|"
    r"long sleeve|\bskirt\b|\btrouser|\bpants\b|\bshirt\b|swimwear|burkini|"
    r"\bsocks?\b|\bgloves?\b|\bshoes?\b|prayer (?:dress|set)")

# framing that cannot travel to a Hebrew storefront, even when the object can
FRAMED = r"ramadan|\beid\b|islam|muslim|mubarak|prayer|hijab|khaleeji|dubai|turkish|arab"

# A positive gate, which matters more here than any of the negative ones.
#
# CJ matches query text loosely across the whole listing, so "volume" returned a
# mascara, an aromatherapy diffuser, a soap dispenser and a pair of jeans, and
# "comb" returned a dog grooming brush. No amount of blocklist keeps up with
# that tail. Instead each shelf declares the nouns a product on it must actually
# contain. A listing that names none of them is not on this shelf, whatever word
# the search engine matched.
REQUIRE = {
    "טיפוח פאה": r"wig|hairpiece|hair piece|lace front|toupee",
    "הגנת לילה": r"bonnet|sleep cap|sleeping cap|night cap|pillow ?case|scrunchie|hair tie|hair band|hair ring|hair rope|turban",
    "תלתלים": r"comb|towel|turban|drying cap|hair wrap|diffuser brush",
    "מסרקי כינים": r"lice|\bnit\b|fine.?tooth|flea|double.?sided.*(?:comb|steel)|stainless.*teeth",
    "נפח ותוספות": r"hair|ponytail|bun|chignon|braid|extension|clip.?in|topper|scrunchie|wig",
    "כיסוי ראש": r"scarf|hijab|headscarf|head ?wrap|turban|bandana|kerchief|shawl|snood|head ?band|veil|\bturban|under ?cap",
    "גברים": r"beard|mustache|moustache|shav",
    "ילדים": r"brush|comb|detangl",
}

# things that are unmistakably not for a human head
NOT_HUMAN = (r"\bpets?\b|\bdogs?\b|\bcats?\b|puppy|kitten|grooming|deshedding|"
             r"slicker|dematting|undercoat|horse(?! tail)|animal|\bbird\b")

# A full wig is not an accessory, it is a different company. It costs $25 to
# $87 landed, it has to match a colour, a length, a density and a lace type, and
# getting any of those wrong is a return. The demand research asked about wig
# CARE, and CJ answered with wigs, because its text matcher cannot tell the two
# apart. So wigs leave here and the question of selling them stays open on its
# own terms rather than riding in on a shortlist about scarves.
FULL_WIG = (r"\bwigs?\b|lace front|\b13x[46]\b|\b4x4\b|\b5x5\b|human hair|"
            r"\bbob\b|body wave|deep wave|water wave|\bdensity\b|hd lace")

# The last pass. Everything here shares a word with a headscarf and is not one.
# CJ's matcher put a KF94 face mask, a football supporters' scarf, a keffiyeh, a
# bridal veil and a wristwatch on the same shelf as a chiffon headscarf, because
# each listing contains the word scarf, hijab or scrunchie somewhere. These are
# not near misses to be sorted out later by a human reading titles; they are
# products that would embarrass the store if one of them reached it.
WRONG_OBJECT = (
    r"kf ?94|face ?mask|masker|filter mask|"
    r"football|soccer|fan scarf|cheer|world cup|"
    r"keffiyeh|kufiya|shemagh|"
    r"\bveil\b|bridal|wedding|"
    r"\blash|eyelash|\bnail\b|"
    r"\bwatch\b|\bbag\b|handbag|clutch|"
    r"baseball|\bhat\b|beanie|wool hat|knitted|"
    r"warming|thickening|\bwinter\b|windproof|neck ?warmer"
)

SHELVES = {
    "wig": "טיפוח פאה", "wig-care": "טיפוח פאה", "wig-tool": "טיפוח פאה",
    "wig-cap": "טיפוח פאה",
    "night": "הגנת לילה", "bonnet": "הגנת לילה", "pillowcase": "הגנת לילה",
    "scrunchie": "הגנת לילה",
    "curl": "תלתלים", "wide-comb": "תלתלים", "hair-towel": "תלתלים",
    "lice": "מסרקי כינים", "lice-comb": "מסרקי כינים",
    "piece": "נפח ותוספות", "extension": "נפח ותוספות", "braid": "נפח ותוספות",
    "volumizer": "נפח ותוספות",
    "cover": "כיסוי ראש", "headscarf": "כיסוי ראש",
    "men": "גברים", "beard": "גברים",
    "kids": "ילדים", "kids-tool": "ילדים",
}


def load():
    by_pid = {}
    for path, key in SOURCES:
        full = os.path.join(HERE, path)
        if not os.path.exists(full):
            continue
        for r in json.load(open(full, encoding="utf-8")):
            r["shelf"] = SHELVES.get(r.get(key) or "", r.get(key) or "?")
            by_pid.setdefault(r["pid"], r)
    return list(by_pid.values())


def run():
    rows = load()
    print("merged, deduped by pid   %5d" % len(rows))

    for label, pat in (("already sold by this store", ALREADY),
                       ("regulated or sensitive", REGULATED),
                       ("powered, wrong voltage", POWERED),
                       ("costume, novelty, off-category", NOISE),
                       ("garments, not accessories", APPAREL)):
        gone = [r for r in rows if re.search(pat, r["name"] or "", re.I)]
        rows = [r for r in rows if not re.search(pat, r["name"] or "", re.I)]
        print("  -%-5d %-34s -> %5d left" % (len(gone), label, len(rows)))

    gone = [r for r in rows if re.search(WRONG_OBJECT, r["name"] or "", re.I)]
    rows = [r for r in rows if not re.search(WRONG_OBJECT, r["name"] or "", re.I)]
    print("  -%-5d %-34s -> %5d left" % (len(gone), "shares a word, not a category", len(rows)))

    gone = [r for r in rows if re.search(FULL_WIG, r["name"] or "", re.I)]
    rows = [r for r in rows if not re.search(FULL_WIG, r["name"] or "", re.I)]
    print("  -%-5d %-34s -> %5d left" % (len(gone), "full wigs, a different business", len(rows)))

    gone = [r for r in rows if re.search(NOT_HUMAN, r["name"] or "", re.I)]
    rows = [r for r in rows if not re.search(NOT_HUMAN, r["name"] or "", re.I)]
    print("  -%-5d %-34s -> %5d left" % (len(gone), "for pets, not people", len(rows)))

    # the positive gate: name the shelf's own noun, or you are not on the shelf
    before = len(rows)
    rows = [r for r in rows
            if r["shelf"] in REQUIRE
            and re.search(REQUIRE[r["shelf"]], r["name"] or "", re.I)]
    print("  -%-5d %-34s -> %5d left"
          % (before - len(rows), "does not name its own category", len(rows)))

    for r in rows:
        r["framed"] = bool(re.search(FRAMED, r["name"] or "", re.I))

    for bar in (200, 100, 50, 25, 10):
        print("  listed >= %-4d %5d   (of which %d need re-framing)"
              % (bar, sum(1 for r in rows if r["listed"] >= bar),
                 sum(1 for r in rows if r["listed"] >= bar and r["framed"])))

    strong = sorted([r for r in rows if r["listed"] >= 25], key=lambda r: -r["listed"])
    print("\nby shelf, at listed >= 25:")
    for k, v in collections.Counter(r["shelf"] for r in strong).most_common():
        print("  %-16s %4d" % (k, v))

    json.dump(strong, open(os.path.join(HERE, "raw4", "strong4.json"), "w",
                           encoding="utf-8"), ensure_ascii=False)

    print("\ntop 45:")
    for r in strong[:45]:
        print("  %5d %-8s %-14s %s%s"
              % (r["listed"], str(r["price"])[:8], r["shelf"],
                 "[framed] " if r["framed"] else "", (r["name"] or "")[:58]))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    run()
