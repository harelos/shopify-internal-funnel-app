# -*- coding: utf-8 -*-
"""What to order, read off what actually sold.

Shade mix comes from the variant title rather than the SKU. The two NOVAHAIR
products encode their shades in different slot orders inside the SKU string
(NOVASALE-4-0-0-4-0-0 against NOVASALE-4-0-0-4-0-0-0), so decoding by position
gets the colours wrong between them. The title names the shade in Hebrew and
cannot drift.

A title is one of two shapes:
    "4 בקבוקים / חום כהה"                  the whole pack is one shade
    "4 בקבוקים / חום כהה 2 + חום בהיר 2"   explicit split
"""
import collections, datetime as dt, io, json, re, sys

TODAY = dt.date(2026, 9, 17)
SHADES = ["חום בהיר", "חום בינוני", "חום כהה", "שחור", "סגול", "אדום", "בלונד"]


def parse(vt):
    if not vt or "/" not in vt:
        return 0, {}
    left, right = [p.strip() for p in vt.split("/", 1)]
    m = re.search(r"(\d+)", left)
    size = int(m.group(1)) if m else 0
    named = []
    for p in [x.strip() for x in right.split("+")]:
        n = re.search(r"(\d+)\s*$", p)
        name = re.sub(r"\d+\s*$", "", p).strip()
        if name in SHADES:
            named.append((name, int(n.group(1)) if n else None))
    if not named:
        return size, {}
    if len(named) == 1 and named[0][1] is None:
        return size, {named[0][0]: size}
    out = collections.Counter()
    for name, n in named:
        out[name] += n or 0
    return size, dict(out)


def run(days, rows):
    lo = TODAY - dt.timedelta(days=days - 1)
    w = [o for o in rows if dt.date.fromisoformat(o["createdAt"][:10]) >= lo]
    bottles, packs, bumps = collections.Counter(), collections.Counter(), collections.Counter()
    kits = 0
    for o in w:
        for li in o["lineItems"]["nodes"]:
            t, vt, q = li["title"], li["variantTitle"] or "", li["quantity"]
            if "NOVAHAIR" in t:
                size, mix = parse(vt)
                if not mix:
                    continue
                packs[size] += q
                kits += q
                for s, n in mix.items():
                    bottles[s] += n * q
            else:
                bumps[t] += q
    return w, bottles, packs, bumps, kits


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    rows = json.load(io.open("orders_recent.json", encoding="utf-8"))
    for days in (7, 14):
        w, bottles, packs, bumps, kits = run(days, rows)
        tot = sum(bottles.values())
        print("=== last %d days: %d orders, %d bottles, %d kits ===" % (days, len(w), tot, kits))
        for s, n in bottles.most_common():
            print("   %-12s %4d  %4.0f%%" % (s, n, 100 * n / tot if tot else 0))
        print("   packs:", dict(sorted(packs.items())))
        print("   add-ons:")
        for b, n in bumps.most_common(8):
            print("      %-46s %d" % (b[:46], n))
        print()
