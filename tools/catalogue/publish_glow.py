# -*- coding: utf-8 -*-
"""Validate the wave-2 skincare copy, then create it in Shopify as drafts.

Run with --check to validate only. Nothing is published: every product is
created with status DRAFT on the nova template, so it is invisible on the
storefront until someone deliberately publishes it.

The image each product gets is the generated hero from gen/out when one exists,
and the CJ packshot tile otherwise. That ordering is the whole point of the
fallback: the draft can be created today with the supplier's own photograph,
and the generated frame replaces it the moment it is ready, without the product
having to be recreated. `--images` alone does that replacement pass.

This script is resumable. Every created product is recorded in published_glow
.json by its source index, and a rerun skips anything already there, because
the failure mode of a half-finished catalogue run is a duplicate product, not a
missing one.
"""
import io, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import copy_glow

SEL = json.load(io.open(os.path.join(HERE, "raw5", "final50.json"), encoding="utf-8"))
ITEMS = copy_glow.ALL
DONE_PATH = os.path.join(HERE, "published_glow.json")

USD_ILS = 3.02          # spot rate, Sept 2026
SHIP_BASE_USD = 1.80
SHIP_PER_GRAM_USD = 0.0062
EM_DASH, EN_DASH = "—", "–"


def num(v):
    """CJ gives weight and price as a number or as a "min-max" range."""
    n = [float(x) for x in re.findall(r"[0-9]+(?:\.[0-9]+)?", str(v or ""))]
    return max(n) if n else 0.0


def landed(cost_usd, weight_field):
    grams = num(weight_field) or 220.0
    return (cost_usd + SHIP_BASE_USD + SHIP_PER_GRAM_USD * grams) * USD_ILS


def hero_image(src_index, fallback_tile):
    """The generated hero if it has been produced, otherwise the CJ packshot."""
    gen = os.path.join(HERE, "gen", "out", "%02d_0_hero.png" % src_index)
    return gen if os.path.exists(gen) else fallback_tile


def check():
    problems, rows = [], []
    seen_handles, seen_titles, seen_src = set(), set(), set()

    for it in ITEMS:
        src = SEL[it["src"]]
        tag = "src%d %s" % (it["src"], it["handle"])

        if it["src"] in seen_src:
            problems.append("%s: duplicate src index" % tag)
        seen_src.add(it["src"])

        for field in ("title", "seo_title", "seo_desc", "body", "alt"):
            if EM_DASH in it[field] or EN_DASH in it[field]:
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
        else:
            h1 = it["title"].split(" - ", 1)[1]
            if len(h1) > 24:
                problems.append("%s: H1 is %d chars, will wrap on mobile" % (tag, len(h1)))

        if len(it["seo_title"]) > 70:
            problems.append("%s: seo_title %d chars, Google will truncate" % (tag, len(it["seo_title"])))
        if not (70 <= len(it["seo_desc"]) <= 165):
            problems.append("%s: seo_desc %d chars, want 70-165" % (tag, len(it["seo_desc"])))

        img = hero_image(it["src"], src.get("tile"))
        if not img or not os.path.exists(img):
            problems.append("%s: no image on disk" % tag)

        cost = landed(num(src["price"]), (src.get("detail") or {}).get("weight"))
        margin = (it["price"] - cost) / it["price"]
        if margin < 0.60:
            problems.append("%s: margin only %.0f%%" % (tag, margin * 100))
        rows.append((it["src"], it["ptype"], it["price"], cost, margin,
                     it["title"], "generated" if "gen" in (img or "") else "CJ tile"))

    missing = sorted(set(range(len(SEL))) - seen_src)
    print("products with copy: %d of %d selected" % (len(ITEMS), len(SEL)))
    if missing:
        print("deliberately not written: %s" % missing)
    print()

    rows.sort(key=lambda r: r[4])
    print("%-5s %-14s %7s %8s %7s %-10s %s"
          % ("src", "type", "price", "landed", "margin", "image", "title"))
    for s, ty, p, c, m, t, im in rows:
        print("%-5d %-14s %7.2f %8.1f %6.0f%% %-10s %s" % (s, ty, p, c, m * 100, im, t))

    print("\nmean margin %.0f%%   mean price %.0f ILS   gross on one of each %.0f ILS"
          % (sum(r[4] for r in rows) / len(rows) * 100,
             sum(r[2] for r in rows) / len(rows),
             sum(r[2] - r[3] for r in rows)))
    n_gen = sum(1 for r in rows if r[6] == "generated")
    print("images: %d generated, %d still on the CJ packshot" % (n_gen, len(rows) - n_gen))

    print()
    if problems:
        print("PROBLEMS (%d):" % len(problems))
        for p in problems:
            print("  " + p)
    else:
        print("no problems found")
    return problems


def load_done():
    if os.path.exists(DONE_PATH):
        return json.load(io.open(DONE_PATH, encoding="utf-8"))
    return {}


def save_done(done):
    json.dump(done, io.open(DONE_PATH, "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)


def publish():
    import shopify
    done = load_done()

    for it in ITEMS:
        key = str(it["src"])
        if key in done:
            continue
        src = SEL[it["src"]]
        payload = {
            "title": it["title"],
            "handle": it["handle"],
            "body_html": it["body"],
            "vendor": "NovaGlow",
            "product_type": it["ptype"],
            "tags": it["tags"] + ["גל שני"],
            "seo_title": it["seo_title"],
            "seo_description": it["seo_desc"],
            "image_alt": it["alt"],
            "tile": hero_image(it["src"], src.get("tile")),
            "price": float(it["price"]),
            "cost_usd": num(src["price"]),
            "compare_at": None,
            "compare_at_verified": False,
        }
        try:
            gid, handle = shopify.create_product(payload)
        except Exception as e:
            print("FAILED %-36s %s" % (it["handle"], str(e)[:160]))
            continue
        done[key] = {"gid": gid, "handle": handle, "title": it["title"]}
        save_done(done)
        print("created %-36s %s" % (handle, it["title"]))
        sys.stdout.flush()

    print("\ncreated %d of %d, all as drafts" % (len(done), len(ITEMS)))


def swap_images():
    """Replace the CJ packshot with the generated hero, without recreating anything.

    The drafts were created with whatever image existed at the time, which for
    most of them is the supplier's own photograph. As generated heroes arrive
    they replace those, and only those: a product whose hero has not been
    generated yet is left alone rather than being touched pointlessly.

    The old media is deleted after the new media is attached and not before, so
    a failure halfway leaves a product with two images rather than none.
    """
    import shopify
    done = load_done()
    if not done:
        print("nothing created yet, run publish first")
        return

    by_src = {str(it["src"]): it for it in ITEMS}
    swapped, skipped = 0, 0

    for src, rec in done.items():
        it = by_src.get(src)
        if not it:
            continue
        gen = os.path.join(HERE, "gen", "out", "%02d_0_hero.png" % int(src))
        if not os.path.exists(gen):
            skipped += 1
            continue
        try:
            existing = shopify.gql(
                "query m($id: ID!) { product(id: $id) { media(first: 20) { nodes { id } } } }",
                {"id": rec["gid"]})["product"]["media"]["nodes"]
            res = shopify.upload_image(gen, os.path.basename(gen))
            d = shopify.gql(shopify.MEDIA, {"productId": rec["gid"], "media": [{
                "originalSource": res, "mediaContentType": "IMAGE",
                "alt": it["alt"]}]})
            errs = d["productCreateMedia"]["mediaUserErrors"]
            if errs:
                print("FAILED %-34s %s" % (it["handle"], errs))
                continue
            if existing:
                shopify.gql(
                    """mutation d($productId: ID!, $mediaIds: [ID!]!) {
                         productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
                           deletedMediaIds mediaUserErrors { message } } }""",
                    {"productId": rec["gid"], "mediaIds": [m["id"] for m in existing]})
            swapped += 1
            print("swapped %-34s %s" % (it["handle"], it["title"]))
            sys.stdout.flush()
        except Exception as e:
            print("FAILED %-34s %s" % (it["handle"], str(e)[:140]))

    print("\nswapped %d, left on the CJ packshot %d" % (swapped, skipped))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if "--check" in sys.argv:
        sys.exit(1 if check() else 0)
    if "--images" in sys.argv:
        swap_images()
    else:
        publish()
