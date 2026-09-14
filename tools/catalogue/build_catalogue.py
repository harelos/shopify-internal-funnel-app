"""Work down the shortlist theme by theme until each shelf is full.

The mix is deliberate. Hair colour is what brings this store its traffic, so it
leads; the maintenance products are what a colour customer buys again; scalp and
tools round out the basket; skin care is a small shelf, not a second business.

A product only reaches the catalogue if a clean packshot survives the image
filter, so the themes are worked in priority order with headroom.
"""
import json, os, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_tiles

HERE = os.path.dirname(os.path.abspath(__file__))

# CJ simply does not stock a deep hair-colour shelf: 82 colour products in
# nearly 18,000 harvested, and few of those are proven sellers. So colour stays
# small and honest, and the weight goes to the maintenance a colour customer
# actually repurchases.
TARGETS = [
    ("dye",   10),
    ("care",  30),
    ("scalp", 14),
    ("tool",  12),
    ("skin",  18),
]
# how many candidates to try per kept product, since most listings have no
# usable packshot
ATTEMPT_RATIO = 8

sl = json.load(open(os.path.join(HERE, "shortlist.json"), encoding="utf-8"))
by_theme = {}
for r in sl:
    by_theme.setdefault(r["theme"], []).append(r)

out_path = os.path.join(HERE, "catalogue_raw.json")
kept_all = []
if os.path.exists(out_path):
    try:
        kept_all = json.load(open(out_path, encoding="utf-8"))
    except Exception:
        kept_all = []
done = set(r["pid"] for r in kept_all)

for theme, target in TARGETS:
    have = sum(1 for r in kept_all if r["theme"] == theme)
    if have >= target:
        print("== %s already at %d/%d" % (theme, have, target))
        continue
    pool = [r for r in by_theme.get(theme, []) if r["pid"] not in done]
    budget = (target - have) * ATTEMPT_RATIO
    print("== %s: have %d, want %d, trying up to %d candidates" % (theme, have, target, budget))
    sys.stdout.flush()

    tried = 0
    for r in pool:
        if sum(1 for x in kept_all if x["theme"] == theme) >= target:
            break
        if tried >= budget:
            break
        tried += 1
        got = build_tiles.run([r], os.path.join(HERE, "_one.json"), verbose=False)
        if got:
            kept_all.extend(got)
            done.add(r["pid"])
            print("   + [%s %d/%d] %s" % (theme,
                  sum(1 for x in kept_all if x["theme"] == theme), target, r["name"][:58]))
            json.dump(kept_all, open(out_path, "w", encoding="utf-8"), ensure_ascii=False)
        sys.stdout.flush()

print("\nTOTAL KEPT: %d" % len(kept_all))
for theme, target in TARGETS:
    print("  %-6s %d/%d" % (theme, sum(1 for r in kept_all if r["theme"] == theme), target))
json.dump(kept_all, open(out_path, "w", encoding="utf-8"), ensure_ascii=False)
