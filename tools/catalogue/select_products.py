"""The final cut, chosen by eye from the contact sheets.

Everything here survived three filters: the listing filter (proven seller, sane
price, not powered, not a regulated medicine), the image filter (one product, no
people, no overlaid English copy), and then my own look at every tile. The
indices are positions in the two review sheets.

Reasons for the cuts that are not obvious from the name are recorded inline.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
main = json.load(open(os.path.join(HERE, "catalogue_raw.json"), encoding="utf-8"))
top = json.load(open(os.path.join(HERE, "catalogue_topup.json"), encoding="utf-8"))

# From the main build. Dropped along the way: party colours and glitter (wrong
# customer), powered styling tools (CJ ships the wrong plug and voltage for
# Israel), a minoxidil spray and a laser comb (registered medicine and medical
# device), and every tile where the cut-out left props, callout arrows or a
# floating subject.
MAIN = [1, 2, 4, 5, 6, 7, 9, 12, 13, 14, 15, 16, 17,
        20, 22, 24, 26, 31, 32, 33, 35, 39,
        40, 43, 46, 48, 49, 50, 51, 54, 58,
        60, 66, 67, 68, 76,
        82]

# From the targeted top-up, which produced the better-looking half of the shelf.
TOP = [0, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18,
       20, 27, 34, 35]

# A few sat in the wrong bucket: the search that found them matched on a word in
# the listing title rather than on what the thing actually is.
RETHEME = {
    1: "tool",    # scalp massage brush, found under a dye query
    48: "dye",    # fruit hair dye cream, found under a scalp query
    40: "tool",   # hair growth comb is a brush
    43: "scalp",
}

sel = []
for i in MAIN:
    r = dict(main[i])
    r["_src"] = "main:%d" % i
    if i in RETHEME:
        r["theme"] = RETHEME[i]
    sel.append(r)

BUCKET_THEME = {
    "mask": "care", "conditioner": "care", "shampoo": "care",
    "serum": "skin", "moisturiser": "skin", "cleanser": "skin", "body": "skin",
}
for i in TOP:
    r = dict(top[i])
    r["_src"] = "top:%d" % i
    r["theme"] = BUCKET_THEME.get(r.get("_bucket"), r["theme"])
    sel.append(r)

order = ["dye", "care", "scalp", "tool", "skin"]
sel.sort(key=lambda r: (order.index(r["theme"]), -r["listed"]))

json.dump(sel, open(os.path.join(HERE, "final_selection.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)

import collections
print("selected %d" % len(sel))
print(dict(collections.Counter(r["theme"] for r in sel)))
print()
for i, r in enumerate(sel):
    print("%2d %-6s %-8s $%-6.2f n=%-5d %s" % (
        i, r["theme"], r["_src"], r["price"], r["listed"], r["name"][:58]))
