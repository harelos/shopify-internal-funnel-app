"""Fill specific gaps left by the first pass.

The broad themes over-served one shelf and under-served others: the skin bucket
came back as six near-identical sunscreens, and the hair bucket was heavy on
growth serums and light on the masks and conditioners a colour customer
actually repurchases. These buckets are narrow on purpose.
"""
import json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_tiles

HERE = os.path.dirname(os.path.abspath(__file__))

BUCKETS = [
    ("mask",       6, r"hair mask|hair treatment mask|keratin mask|deep conditioning|hair spa",
                      r"face|facial|sheet mask|sleep"),
    ("conditioner",5, r"conditioner|leave.?in|detangl.*spray|hair milk|hair cream",
                      r"face|body|shave"),
    ("shampoo",    5, r"shampoo",
                      r"dye|color|colour|black hair|dog|pet|car |carpet"),
    ("serum",      7, r"hyaluronic|niacinamide|retinol|vitamin c|peptide|ampoule|face serum|facial serum|essence",
                      r"hair|scalp|sunscreen|spf|shampoo"),
    ("moisturiser",6, r"face cream|facial cream|moisturiz|moisturis|eye cream|night cream|day cream|lotion",
                      r"hair|scalp|sunscreen|spf|body wash|hand"),
    ("cleanser",   4, r"cleanser|face wash|facial wash|cleansing foam|toner|micellar",
                      r"hair|scalp|electric|brush|machine"),
    ("body",       4, r"body lotion|body butter|hand cream|body scrub|body oil|foot cream",
                      r"hair|scalp|bleach"),
]

sl = json.load(open(os.path.join(HERE, "shortlist.json"), encoding="utf-8"))
cat_path = os.path.join(HERE, "catalogue_raw.json")
kept_all = json.load(open(cat_path, encoding="utf-8"))
done = set(r["pid"] for r in kept_all)
# and never re-pick a source photo already used elsewhere in the catalogue
used_src = set(r.get("src_image") for r in kept_all)

out_path = os.path.join(HERE, "catalogue_topup.json")
topup = []
if os.path.exists(out_path):
    topup = json.load(open(out_path, encoding="utf-8"))
    done |= set(r["pid"] for r in topup)
    used_src |= set(r.get("src_image") for r in topup)

for label, target, want_re, drop_re in BUCKETS:
    have = sum(1 for r in topup if r.get("_bucket") == label)
    if have >= target:
        print("== %s already %d/%d" % (label, have, target))
        continue
    want = re.compile(want_re, re.I)
    drop = re.compile(drop_re, re.I)
    pool = [r for r in sl
            if r["pid"] not in done and want.search(r["name"]) and not drop.search(r["name"])]
    print("== %s: %d/%d, %d candidates" % (label, have, target, len(pool)))
    sys.stdout.flush()

    for r in pool[: (target - have) * 10]:
        if sum(1 for x in topup if x.get("_bucket") == label) >= target:
            break
        got = build_tiles.run([r], os.path.join(HERE, "_one.json"), verbose=False)
        if not got:
            continue
        g = got[0]
        if g.get("src_image") in used_src:
            continue                       # same photo, different listing
        g["_bucket"] = label
        topup.append(g)
        done.add(r["pid"])
        used_src.add(g.get("src_image"))
        print("   + [%s %d/%d] %s" % (label,
              sum(1 for x in topup if x.get("_bucket") == label), target, r["name"][:56]))
        json.dump(topup, open(out_path, "w", encoding="utf-8"), ensure_ascii=False)
        sys.stdout.flush()

print("\nTOPUP TOTAL: %d" % len(topup))
for label, target, _, _ in BUCKETS:
    print("  %-12s %d/%d" % (label, sum(1 for r in topup if r.get("_bucket") == label), target))
