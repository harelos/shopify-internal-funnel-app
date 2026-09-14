# -*- coding: utf-8 -*-
"""Rebuild every product tile: one object, one angle, one scale.

The first pass picked the cleanest-looking photo. That was the wrong objective:
the cleanest photo is often the bottle posed beside its carton, and cutting the
carton away afterwards leaves an awkward crop.

So the choice is made on the cut-out instead. Every candidate photo in the CJ
set is actually segmented, and the one that already contains a single upright
product wins. Only if none does do we fall back to isolating the bottle out of a
two-object shot.

Products that genuinely are several pieces (a shampoo and conditioner set, a
box of combs, a colouring kit) are marked SETS and keep all their objects.
"""
import json, os, sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import isolate, pickimage

CACHE = os.path.join(HERE, "cache")
OUT = os.path.join(HERE, "tiles2")
os.makedirs(OUT, exist_ok=True)

# handles where more than one object in frame is the product, not a mistake
SETS = {
    "novahair-rosemary-duo",        # shampoo and conditioner
    "novahair-comb-set",            # ten combs
    "novahair-coloring-kit",        # bowl, brush, comb
    "novahair-scalp-ampoules",      # a course of ampoules
}


def upright(sub):
    """A bottle stands up. Penalise a subject lying on its side or sliced thin."""
    w, h = sub.size
    if w <= 0 or h <= 0:
        return -9.0
    ar = h / float(w)
    if ar < 0.45:
        return -9.0                     # lying flat, usually a mis-cut
    if ar > 6.0:
        return -9.0                     # a sliver, the segmentation failed
    return min(ar, 2.8) * 0.6


def judge(path, allow_multi):
    """Segment one candidate and score how well it works as our tile."""
    try:
        rgba = isolate.alpha_of(path)
    except Exception as e:
        return None, -99, "segmentation failed: %s" % e
    a = np.asarray(rgba.getchannel("A"), dtype=np.uint8)

    covered = float((a > 28).mean())
    if covered < 0.035 or covered > 0.92:
        return None, -99, "coverage %.2f" % covered

    comps = isolate.components(a)
    if not comps:
        return None, -99, "nothing solid"

    sub, why = isolate.isolate(path, allow_multi=allow_multi)
    if sub is None:
        return None, -99, why

    s = upright(sub)
    if s <= -9:
        return None, -99, "bad shape %dx%d" % sub.size

    # the whole point: a photo that already holds one product needs no surgery
    if not allow_multi:
        if len(comps) == 1:
            s += 6.0
        elif len(comps) == 2:
            s += 1.0
        else:
            s -= 2.5 * (len(comps) - 2)

    # a bigger subject in the source means a sharper tile after scaling
    s += min(covered / 0.30, 1.0) * 2.0

    # reuse the earlier checks so people, collages and ad overlays stay out
    _, ps, pwhy = pickimage.score(path)
    if ps <= -90:
        return None, -99, pwhy
    s += ps / 28.0

    return sub, s, "%d obj, cover %.2f" % (len(comps), covered)


def best_tile(row):
    urls = row.get("_image_set") or []
    allow_multi = row["handle"] in SETS
    ranked = []
    for idx, u in enumerate(urls[:6]):
        p = pickimage.fetch(u, CACHE)
        if not p:
            continue
        sub, s, why = judge(p, allow_multi)
        if sub is None:
            continue
        ranked.append((s - idx * 0.7, sub, p, why))
    if not ranked:
        return None, None, "no usable photo in the set"
    ranked.sort(key=lambda t: -t[0])
    _, sub, path, why = ranked[0]
    return sub, path, why


if __name__ == "__main__":
    sel = json.load(open(os.path.join(HERE, "final_selection.json"), encoding="utf-8"))
    pub = json.load(open(os.path.join(HERE, "published.json"), encoding="utf-8"))
    det_dir = os.path.join(HERE, "raw", "detail")

    rows = []
    for k, v in pub.items():
        r = dict(sel[int(k)])
        r["handle"] = v["handle"]
        r["gid"] = v["gid"]
        r["heb_title"] = v["title"]
        dp = os.path.join(det_dir, "%s.json" % r["pid"])
        urls = []
        if os.path.exists(dp):
            d = json.load(open(dp, encoding="utf-8")).get("data") or {}
            urls = d.get("productImageSet") or []
            if isinstance(urls, str):
                try:
                    urls = json.loads(urls)
                except Exception:
                    urls = [urls]
        r["_image_set"] = urls or [r["img"]]
        rows.append(r)

    out_json = os.path.join(HERE, "tiles2.json")
    done = []
    if os.path.exists(out_json):
        try:
            done = json.load(open(out_json, encoding="utf-8"))
        except Exception:
            done = []
    have = {d["handle"] for d in done}

    for r in rows:
        # resume: a tile already on disk is not worth another minute of rembg
        if r["handle"] in have and os.path.exists(os.path.join(OUT, "%s.jpg" % r["handle"])):
            continue
        sub, src, why = best_tile(r)
        if sub is None:
            print("  FAIL %-34s %s" % (r["handle"], why))
            continue
        ml = isolate.declared_ml(r["heb_title"], r["name"],
                                 (r.get("detail") or {}).get("desc", ""))
        tile = os.path.join(OUT, "%s.jpg" % r["handle"])
        isolate.compose(sub, ml).save(tile, "JPEG", quality=90, optimize=True)
        r["tile2"] = tile
        r["ml"] = ml
        r["_src2"] = src
        done.append(r)
        have.add(r["handle"])
        json.dump(done, open(out_json, "w", encoding="utf-8"), ensure_ascii=False)
        print("  ok   %-34s ml=%-6s %s" % (r["handle"], ml, why))
        sys.stdout.flush()

    json.dump(done, open(out_json, "w", encoding="utf-8"), ensure_ascii=False)
    print("\nrebuilt %d of %d tiles" % (len(done), len(rows)))
