# -*- coding: utf-8 -*-
"""Check every product, then create them in Shopify as drafts.

Run with --check to validate only. Nothing is published: every product is
created with status DRAFT on the nova template, so it is invisible on the
storefront until someone deliberately publishes it.
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from copy_hair import HAIR
from copy_skin import SKIN

SEL = json.load(open(os.path.join(HERE, "final_selection.json"), encoding="utf-8"))
ITEMS = HAIR + SKIN

USD_ILS = 3.02          # spot rate, Sept 2026

# CJ bills the line haul to Israel by weight, not per order, so a flat per-unit
# figure badly overstates the cost of a 30g hand cream and understates a 500g
# shampoo. This is the packet rate plus a little headroom.
SHIP_BASE_USD = 1.80
SHIP_PER_GRAM_USD = 0.0062

EM_DASH = "—"
EN_DASH = "–"


def grams(weight_field):
    """CJ gives weight as a number or a "min-max" range. Take the top of the range."""
    if weight_field is None:
        return 220.0                       # unknown, assume a mid-size bottle
    txt = str(weight_field)
    nums = [float(x) for x in re.findall(r"[0-9]+(?:\.[0-9]+)?", txt)]
    return max(nums) if nums else 220.0


def landed(cost_usd, weight_field):
    ship_usd = SHIP_BASE_USD + SHIP_PER_GRAM_USD * grams(weight_field)
    return (cost_usd + ship_usd) * USD_ILS


def check():
    problems, rows = [], []
    seen_handles, seen_titles, seen_src = set(), set(), set()

    for it in ITEMS:
        src = SEL[it["src"]]
        tag = "src%d %s" % (it["src"], it["title"])

        if it["src"] in seen_src:
            problems.append("%s: duplicate src index" % tag)
        seen_src.add(it["src"])

        for field in ("title", "seo_title", "seo_desc", "body", "alt"):
            text = it[field]
            if EM_DASH in text or EN_DASH in text:
                problems.append("%s: dash character in %s" % (tag, field))

        if it["handle"] in seen_handles:
            problems.append("%s: duplicate handle" % tag)
        seen_handles.add(it["handle"])
        if not re.fullmatch(r"[a-z0-9-]+", it["handle"]):
            problems.append("%s: handle is not url safe" % tag)

        if it["title"] in seen_titles:
            problems.append("%s: duplicate title" % tag)
        seen_titles.add(it["title"])

        # the PDP splits on " - " to get the brand eyebrow and the H1
        if it["title"].count(" - ") != 1:
            problems.append("%s: title needs exactly one ' - ' delimiter" % tag)
        h1 = it["title"].split(" - ", 1)[1]
        if len(h1) > 24:
            problems.append("%s: H1 is %d chars, will wrap on mobile" % (tag, len(h1)))

        if len(it["seo_title"]) > 70:
            problems.append("%s: seo_title %d chars, Google will truncate" % (tag, len(it["seo_title"])))
        if not (70 <= len(it["seo_desc"]) <= 165):
            problems.append("%s: seo_desc %d chars, want 70-165" % (tag, len(it["seo_desc"])))

        if not os.path.exists(src["tile"]):
            problems.append("%s: tile missing" % tag)

        cost = landed(src["price"], (src.get("detail") or {}).get("weight"))
        margin = (it["price"] - cost) / it["price"]
        if margin < 0.60:
            problems.append("%s: margin only %.0f%%" % (tag, margin * 100))
        rows.append((it["src"], src["theme"], it["price"], cost, margin, it["title"]))

    missing = sorted(set(range(len(SEL))) - seen_src)
    print("products with copy: %d of %d selected" % (len(ITEMS), len(SEL)))
    if missing:
        print("deliberately not written: %s" % missing)
    print()

    rows.sort(key=lambda r: r[4])
    print("%-6s %-6s %7s %8s %7s  %s" % ("src", "theme", "price", "landed", "margin", "title"))
    for s, th, p, c, m, t in rows:
        print("%-6d %-6s %7.0f %8.1f %6.0f%%  %s" % (s, th, p, c, m * 100, t))

    gross = sum(r[2] - r[3] for r in rows)
    print("\nmean margin %.0f%%   mean price %.0f ILS   gross per one-of-each %.0f ILS"
          % (sum(r[4] for r in rows) / len(rows) * 100,
             sum(r[2] for r in rows) / len(rows), gross))

    print()
    if problems:
        print("PROBLEMS (%d):" % len(problems))
        for p in problems:
            print("  " + p)
    else:
        print("no problems found")
    return problems


def publish():
    import shopify
    done_path = os.path.join(HERE, "published.json")
    done = json.load(open(done_path, encoding="utf-8")) if os.path.exists(done_path) else {}

    for it in ITEMS:
        key = str(it["src"])
        if key in done:
            continue
        src = SEL[it["src"]]
        payload = {
            "title": it["title"],
            "handle": it["handle"],
            "body_html": it["body"],
            "vendor": "NovaGlow" if it["handle"].startswith("novaglow") else "NovaHair",
            "product_type": it["ptype"],
            "tags": it["tags"] + ["ייבוא ספטמבר"],
            "seo_title": it["seo_title"],
            "seo_description": it["seo_desc"],
            "image_alt": it["alt"],
            "tile": src["tile"],
            "price": float(it["price"]),
            "cost_usd": float(src["price"]),
            "compare_at": None,
            "compare_at_verified": False,
        }
        try:
            gid, handle = shopify.create_product(payload)
        except Exception as e:
            print("FAILED %-36s %s" % (it["handle"], str(e)[:160]))
            continue
        done[key] = {"gid": gid, "handle": handle, "title": it["title"]}
        json.dump(done, open(done_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print("created %-34s %s" % (handle, it["title"]))
        sys.stdout.flush()

    print("\npublished %d of %d" % (len(done), len(ITEMS)))


if __name__ == "__main__":
    if "--check" in sys.argv:
        sys.exit(1 if check() else 0)
    publish()
