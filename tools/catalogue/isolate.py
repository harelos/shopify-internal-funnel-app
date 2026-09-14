# -*- coding: utf-8 -*-
"""Reduce a packshot to the single product, and put every product at one scale.

Two problems with the first pass. CJ photographs a bottle next to its carton, so
half the tiles showed two objects. And each subject was scaled to fill its own
tile, so a 30ml dropper and a 500ml shampoo ended up the same height on the
grid, which reads as careless next to a real beauty shelf.

This does three things:

  1. cuts the background out
  2. keeps ONE object, choosing the bottle over the carton
  3. scales by the product's real declared volume rather than to fit, so a
     500ml bottle is visibly bigger than a 30ml dropper across the whole grid

A genuine multi-piece product (a shampoo and conditioner sold as a set) is
exempt from step 2, because there the several objects are the thing being sold.
"""
import math, os, re

import numpy as np
from PIL import Image
from scipy import ndimage

CANVAS = 1200
BG = (250, 247, 242)
MARGIN = 0.07

_session = None


def session():
    global _session
    if _session is None:
        from rembg import new_session
        _session = new_session("isnet-general-use")
    return _session


def alpha_of(path):
    from rembg import remove
    src = Image.open(path).convert("RGB")
    out = remove(src, session=session()).convert("RGBA")
    return out


def split_mask(mask):
    """Label the mask, eroding first so a bottle touching its carton separates.

    CJ stands the bottle against the box, so the two share a few pixels and a
    plain labelling returns them as one blob. Eroding breaks that bridge; each
    surviving core is then grown back inside the original mask, so the objects
    keep their true edges.
    """
    lab, n = ndimage.label(mask)
    if n == 0:
        return lab, n

    for iters in (6, 10, 14):
        core = ndimage.binary_erosion(mask, iterations=iters)
        clab, cn = ndimage.label(core)
        if cn < 2:
            continue
        sizes = ndimage.sum(core, clab, range(1, cn + 1))
        if sizes.max() <= 0:
            continue
        # ignore erosion crumbs; we want two real cores, not a core and a speck
        real = [i + 1 for i, sz in enumerate(sizes) if sz >= sizes.max() * 0.18]
        if len(real) < 2:
            continue
        # grow each core back to its own territory within the original mask
        idx = np.zeros(mask.shape, dtype=np.int32)
        for new_id, cid in enumerate(real, start=1):
            idx[clab == cid] = new_id
        grown = ndimage.grey_dilation(idx, size=(2 * iters + 5, 2 * iters + 5))
        out = np.where(mask, grown, 0).astype(np.int32)
        if out.max() >= 2:
            return out, int(out.max())
    return lab, n


def components(alpha, min_share=0.04):
    """Significant blobs in the cut-out, largest first."""
    mask = alpha > 28
    lab, n = split_mask(mask)
    if n == 0:
        return []
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    if sizes.max() <= 0:
        return []
    biggest = sizes.max()
    out = []
    for i, s in enumerate(sizes, start=1):
        if s < biggest * min_share:
            continue
        ys, xs = np.where(lab == i)
        out.append({
            "id": i, "area": float(s),
            "box": (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1),
        })
    out.sort(key=lambda c: -c["area"])
    return out


def bottleness(c):
    """How much a blob looks like a bottle rather than a carton.

    A carton is a filled rectangle: its pixels occupy nearly its whole bounding
    box. A bottle has a neck, a cap and shoulders, so it leaves the corners of
    its box empty. Height helps too, but fill is the reliable signal.
    """
    x0, y0, x1, y1 = c["box"]
    w, h = x1 - x0, y1 - y0
    if w <= 0 or h <= 0:
        return -1.0
    fill = c["area"] / float(w * h)
    tall = h / float(w)
    score = 0.0
    score += (1.0 - fill) * 3.0          # the emptier its box, the more bottle-like
    score += min(tall, 3.0) * 0.45       # bottles are usually taller than wide
    score += min(c["area"] / 40000.0, 1.0) * 0.5   # do not pick a tiny fleck
    return score


def isolate(path, allow_multi=False):
    """Return an RGBA of just the product, or None with a reason."""
    rgba = alpha_of(path)
    a = np.asarray(rgba.getchannel("A"), dtype=np.uint8)

    covered = float((a > 28).mean())
    if covered < 0.03:
        return None, "cut-out found almost nothing"
    if covered > 0.95:
        return None, "cut-out kept the whole frame"

    comps = components(a)
    if not comps:
        return None, "no solid subject"

    if allow_multi or len(comps) == 1:
        keep = {c["id"] for c in comps}
    else:
        # one object only, and it should be the bottle rather than its carton
        best = max(comps, key=bottleness)
        keep = {best["id"]}

    lab, _ = split_mask(a > 28)
    mask = np.isin(lab, list(keep))
    a2 = np.where(mask, a, 0).astype(np.uint8)
    rgba.putalpha(Image.fromarray(a2))

    ys, xs = np.where(a2 > 28)
    if len(xs) == 0:
        return None, "nothing left after isolating"
    sub = rgba.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
    if min(sub.size) < 60:
        return None, "subject too small to use"
    return sub, "kept %d of %d objects" % (len(keep), len(comps))


# ---------------------------------------------------------------- sizing

VOL_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(ml|g|oz|gram|grams|מ\"ל|מ״ל|גרם)", re.I)


def declared_ml(*texts):
    """Best guess at the product's real volume, for scaling across the grid."""
    best = None
    for t in texts:
        if not t:
            continue
        for m in VOL_RE.finditer(str(t)):
            n = float(m.group(1))
            unit = m.group(2).lower()
            if unit.startswith("oz"):
                n *= 29.57
            if 5 <= n <= 1000:
                best = n if best is None else max(best, n)
    return best


def height_fraction(ml):
    """How tall this product should stand on the tile.

    A cube root, because volume grows with the cube of height: a 500ml bottle is
    bigger than a 30ml dropper but not seventeen times taller. Clamped so the
    smallest item is still clearly readable and the largest still has margin.
    """
    if not ml:
        ml = 120.0                       # unknown, treat as a mid-size bottle
    ref = 200.0                          # a standard shampoo bottle
    rel = (ml / ref) ** (1.0 / 3.0)
    frac = 0.76 * rel
    return max(0.52, min(0.88, frac))


def compose(sub, ml=None, uniform=False):
    """Place the product on the standard tile, sized by its real volume."""
    inner = CANVAS * (1 - 2 * MARGIN)
    w, h = sub.size

    if uniform:
        scale = min(inner / w, inner / h)
    else:
        target_h = CANVAS * height_fraction(ml)
        scale = target_h / float(h)
        # never let a wide product run off the sides
        if w * scale > inner:
            scale = inner / float(w)

    scale = min(scale, 3.0)
    nw, nh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
    sub = sub.resize((nw, nh), Image.LANCZOS)

    tile = Image.new("RGB", (CANVAS, CANVAS), BG)
    # centred, because on the PDP the tile is seen on its own; the shared scale
    # is what keeps the collection grid honest, not a shared baseline
    tile.paste(sub, ((CANVAS - nw) // 2, (CANVAS - nh) // 2), sub)
    return tile
