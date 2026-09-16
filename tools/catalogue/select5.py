# -*- coding: utf-8 -*-
"""Pick the wave-2 shortlist, and refuse to pad it.

Two jobs. The first is the brief: fifty products that do not repeat each other.
The second is the one the data forced: say out loud how thin some of these
shelves are, rather than reaching further down the listedNum tail to make the
number fifty come out.

Repetition is the harder of the two. CJ's catalogue is full of the same scarf
listed by eleven sellers under eleven near-identical titles, so a plain
listedNum sort returns "Women's Fashion Solid Color Hijab" four times in the top
forty. Deduping on pid does nothing about that, because they are genuinely
different pids. So the gate is on the title's word set: an item is dropped when
it shares most of its meaningful words with something already picked on the same
shelf, and again when it shares a picture with it.

The quotas are caps, not targets. A shelf that cannot fill its cap at the
quality bar stays short and is reported short.
"""
import collections, io, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))

# words that carry no distinguishing information in this catalogue
STOP = set("""women womens woman lady ladies female girls new fashion style
premium quality solid color colour plain hot sale wholesale free shipping
piece pieces pcs set sets pack for and the with of in a an cm size high
soft cute simple casual classic""".split())

# shelf -> (cap, floor). floor is the minimum listedNum this shelf will accept.
QUOTA = [
    # A routine, not a pile. Cleanse is missing because CJ has no cleanser
    # shelf worth the name, so the shelves that exist are built deep instead of
    # a shallow one being faked to look complete.
    ("לחות",          16, 10),
    ("טונר ומיסט",  16, 10),
    ("סרום ואמפולה", 11, 10),
    # five is a shelf. nineteen is the same stone nineteen times.
    ("כלים",           5, 60),
    ("פילינג",        2, 10),
    ("פצעונים",       1, 10),
]


def words(name):
    toks = re.findall(r"[a-z]+", (name or "").lower())
    return {t for t in toks if len(t) > 2 and t not in STOP}


def head(name, n=3):
    """The first few meaningful words, in order.

    Jaccard sees two titles as different when they share only a short prefix:
    "Wiyun Collagen Moisturizer, Moisturizes and improves dull skin" against
    "Wiyun Collagen Moisturizer, Gentle, Hydrating Daily Skin Care" scores 0.30,
    because each one's tail of adjectives is long and unshared. But the shared
    part is the brand and the product, and the unshared part is marketing. A
    matching opening is therefore a stronger signal of the same item than a
    diverging tail is of a different one.
    """
    toks = [t for t in re.findall(r"[a-z]+", (name or "").lower())
            if len(t) > 2 and t not in STOP]
    return tuple(toks[:n])


def overlaps(a, b):
    """Jaccard on meaningful words, with a stricter rule for short titles.

    Jaccard fails on short generic names. "Body Moisturizer", "Body Moisturizer
    Hydrating Skin Care" and "Body Moisturizer Gentle Moisturizing" reduce to
    word sets of 2, 4 and 3, so their overlap scores below the threshold and all
    three survive as "different products". They are one product listed three
    times. So when either title is down to three meaningful words or fewer, the
    test becomes containment: if the shorter set sits inside the longer one,
    they are the same shelf item.
    """
    if not a or not b:
        return False
    if min(len(a), len(b)) <= 3 and (a <= b or b <= a):
        return True
    return len(a & b) / float(len(a | b)) >= 0.42


def run():
    rows = json.load(io.open(os.path.join(HERE, "raw5", "tiled_all.json"), encoding="utf-8"))
    # The ranker's exclusions are re-applied here, because a product can only be
    # rejected by a rule that existed when it was ranked, and three of these
    # rules were written after seeing what got through: boxer shorts arrived on
    # a skincare shelf because "toner" is inside the word, and a knitted top
    # arrived because "patch" is inside "patchwork".
    import rank5, image_rejects
    rows = [r for r in rows
            if not re.search(rank5.NOT_BEAUTY, r["name"] or "", re.I)
            and not re.search(rank5.REGULATED, r["name"] or "", re.I)
            and len(words(r["name"])) >= 2
            and not image_rejects.is_rejected(r["name"])]

    by_shelf = collections.defaultdict(list)
    for r in rows:
        by_shelf[r["shelf"]].append(r)

    picked, report = [], []
    for shelf, cap, floor in QUOTA:
        pool = sorted([r for r in by_shelf.get(shelf, []) if r["listed"] >= floor],
                      key=lambda r: -r["listed"])
        taken, seen_words, seen_img, seen_heads = [], [], set(), set()
        for r in pool:
            if len(taken) >= cap:
                break
            w = words(r["name"])
            if any(overlaps(w, prev) for prev in seen_words):
                continue
            h = head(r["name"])
            if len(h) == 3 and h in seen_heads:
                continue
            if r.get("img") in seen_img:
                continue
            taken.append(r)
            seen_words.append(w)
            seen_img.add(r.get("img"))
            seen_heads.add(h)
        picked += taken
        report.append((shelf, cap, floor, len(pool), len(taken)))

    print("%-14s %4s %6s %8s %7s" % ("shelf", "cap", "floor", "eligible", "picked"))
    for shelf, cap, floor, pool, got in report:
        flag = "" if got >= cap else "   SHORT"
        print("%-14s %4d %6d %8d %7d%s" % (shelf, cap, floor, pool, got, flag))
    print("\n%d picked of %d asked for" % (len(picked), sum(q[1] for q in QUOTA)))

    framed = sum(1 for r in picked if r.get("framed"))
    print("%d of them carry religious framing in the title or image" % framed)

    json.dump(picked, io.open(os.path.join(HERE, "raw5", "final50.json"), "w",
                              encoding="utf-8"), ensure_ascii=False, indent=1)

    print()
    for shelf, _, _, _, _ in report:
        items = [r for r in picked if r["shelf"] == shelf]
        if not items:
            continue
        print("--- %s (%d)" % (shelf, len(items)))
        for r in items:
            print("   %5d $%-8s %s%s" % (r["listed"], str(r["price"])[:8],
                                         "[framed] " if r.get("framed") else "",
                                         (r["name"] or "")[:60]))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    run()
