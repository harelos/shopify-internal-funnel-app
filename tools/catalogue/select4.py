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
    # Caps are set from what survived the ranker, not from what the demand
    # research hoped for. Five of the eight shelves the research pointed at are
    # absent from this table because CJ returned nothing on them at any
    # phrasing, and an empty row would read as an oversight rather than a
    # finding.
    ("כיסוי ראש",   36, 22),
    ("נפח ותוספות", 10, 18),
    ("הגנת לילה",    4, 10),
]


def words(name):
    toks = re.findall(r"[a-z]+", (name or "").lower())
    return {t for t in toks if len(t) > 2 and t not in STOP}


def overlaps(a, b):
    """Jaccard on meaningful words. 0.55 separates 'another scarf' from 'the
    same scarf relisted', which is the line that matters here."""
    if not a or not b:
        return False
    return len(a & b) / float(len(a | b)) >= 0.55


def run():
    rows = json.load(io.open(os.path.join(HERE, "raw4", "strong4.json"), encoding="utf-8"))
    by_shelf = collections.defaultdict(list)
    for r in rows:
        by_shelf[r["shelf"]].append(r)

    picked, report = [], []
    for shelf, cap, floor in QUOTA:
        pool = sorted([r for r in by_shelf.get(shelf, []) if r["listed"] >= floor],
                      key=lambda r: -r["listed"])
        taken, seen_words, seen_img = [], [], set()
        for r in pool:
            if len(taken) >= cap:
                break
            w = words(r["name"])
            if any(overlaps(w, prev) for prev in seen_words):
                continue
            if r.get("img") in seen_img:
                continue
            taken.append(r)
            seen_words.append(w)
            seen_img.add(r.get("img"))
        picked += taken
        report.append((shelf, cap, floor, len(pool), len(taken)))

    print("%-14s %4s %6s %8s %7s" % ("shelf", "cap", "floor", "eligible", "picked"))
    for shelf, cap, floor, pool, got in report:
        flag = "" if got >= cap else "   SHORT"
        print("%-14s %4d %6d %8d %7d%s" % (shelf, cap, floor, pool, got, flag))
    print("\n%d picked of %d asked for" % (len(picked), sum(q[1] for q in QUOTA)))

    framed = sum(1 for r in picked if r.get("framed"))
    print("%d of them carry religious framing in the title or image" % framed)

    json.dump(picked, io.open(os.path.join(HERE, "raw4", "picks.json"), "w",
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
