# -*- coding: utf-8 -*-
"""Second pass on the products whose bottle would not separate from its carton.

In these photos the box and the bottle overlap rather than merely touch, so
eroding by a dozen pixels never breaks the bridge between them. This pass tries
much harder erosion, and if the two still will not part it falls back to a
vertical cut at the deepest valley in the mask's column profile, which is where
a bottle standing in front of a box meets its edge.

If nothing works the product keeps the tile it has. A carton beside its bottle
is not wrong, it is just not what was asked for.
"""
import json, os, sys

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import isolate, pickimage

CACHE = os.path.join(HERE, "cache")
OUT = os.path.join(HERE, "tiles2")

STUBBORN = [
    "novahair-batana-oil-120",
    "novahair-ginger-root-oil",
    "novahair-darkening-shampoo-bar",
    "novahair-shea-mask",
    "novahair-scalp-serum",
    "novahair-keratin-mask",
]


def hard_split(mask):
    """Erode much harder than the normal path before giving up."""
    for iters in (18, 24, 30, 36):
        core = ndimage.binary_erosion(mask, iterations=iters)
        clab, cn = ndimage.label(core)
        if cn < 2:
            continue
        sizes = ndimage.sum(core, clab, range(1, cn + 1))
        real = [i + 1 for i, sz in enumerate(sizes) if sz >= sizes.max() * 0.12]
        if len(real) < 2:
            continue
        idx = np.zeros(mask.shape, dtype=np.int32)
        for new_id, cid in enumerate(real, start=1):
            idx[clab == cid] = new_id
        grown = ndimage.grey_dilation(idx, size=(2 * iters + 5, 2 * iters + 5))
        out = np.where(mask, grown, 0).astype(np.int32)
        if out.max() >= 2:
            return out, int(out.max())
    return None, 0


def valley_split(mask):
    """Cut at the narrowest column, where a bottle in front of a box meets it."""
    cols = mask.sum(axis=0).astype(np.float32)
    on = np.where(cols > 0)[0]
    if len(on) < 60:
        return None, 0
    lo, hi = on[0], on[-1]
    inner = cols[lo:hi + 1]
    # ignore the outer fifth so we do not "split" off a cap or a shadow
    pad = max(8, len(inner) // 5)
    window = inner[pad:-pad]
    if len(window) < 10:
        return None, 0
    cut = int(np.argmin(window)) + pad + lo
    if cols[cut] > 0.55 * cols.max():
        return None, 0                 # no real valley, the two truly overlap
    lab = np.zeros(mask.shape, dtype=np.int32)
    lab[:, :cut][mask[:, :cut]] = 1
    lab[:, cut:][mask[:, cut:]] = 2
    return lab, 2


def pick(lab, n, alpha):
    """Of the separated pieces, take the one that looks most like a bottle."""
    comps = []
    for i in range(1, n + 1):
        m = lab == i
        area = int(m.sum())
        if area < 2500:
            continue
        ys, xs = np.where(m)
        comps.append({"id": i, "area": float(area),
                      "box": (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)})
    if len(comps) < 2:
        return None
    best = max(comps, key=isolate.bottleness)
    return best["id"]


def redo(row):
    urls = row.get("_image_set") or [row["img"]]
    for idx, u in enumerate(urls[:6]):
        path = pickimage.fetch(u, CACHE)
        if not path:
            continue
        try:
            rgba = isolate.alpha_of(path)
        except Exception:
            continue
        a = np.asarray(rgba.getchannel("A"), dtype=np.uint8)
        cov = float((a > 28).mean())
        if cov < 0.035 or cov > 0.92:
            continue
        mask = a > 28

        for splitter in (hard_split, valley_split):
            lab, n = splitter(mask)
            if not n:
                continue
            keep = pick(lab, n, a)
            if keep is None:
                continue
            m2 = lab == keep
            a2 = np.where(m2, a, 0).astype(np.uint8)
            ys, xs = np.where(a2 > 28)
            if len(xs) < 50:
                continue
            w = int(xs.max() - xs.min()); h = int(ys.max() - ys.min())
            if w < 40 or h < 80 or h / float(max(w, 1)) < 0.6:
                continue          # not a standing bottle, do not use it
            out = rgba.copy()
            out.putalpha(Image.fromarray(a2))
            sub = out.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
            return sub, "%s on image #%d" % (splitter.__name__, idx + 1)
    return None, "no separation possible"


if __name__ == "__main__":
    rows = {r["handle"]: r for r in json.load(open(os.path.join(HERE, "tiles2.json"), encoding="utf-8"))}
    changed = 0
    for h in STUBBORN:
        r = rows.get(h)
        if not r:
            print("  %-34s not built yet" % h)
            continue
        sub, why = redo(r)
        if sub is None:
            print("  keep %-34s %s" % (h, why))
            continue
        isolate.compose(sub, r.get("ml")).save(os.path.join(OUT, "%s.jpg" % h),
                                               "JPEG", quality=90, optimize=True)
        changed += 1
        print("  fixed %-33s %s" % (h, why))
    print("\nrebuilt %d of %d" % (changed, len(STUBBORN)))
