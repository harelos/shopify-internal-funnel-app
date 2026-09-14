"""Turn a CJ listing photo into a store-consistent product tile.

The brief: the product only, background removed, every tile the same size, and
no English packaging shots. So this cuts the subject out with rembg, drops the
alpha onto a warm-white square that matches the PDP tiles, and pads to a fixed
margin so a tall bottle and a wide jar occupy the same visual weight.

Listings that are collages, text banners or lifestyle scenes fail the checks in
score_image() and never reach the store.
"""
import io, os, sys, json, math, subprocess

import numpy as np
from PIL import Image, ImageFilter, ImageStat

CANVAS = 1200                 # square tile the PDP expects
MARGIN = 0.085                # fraction of the canvas left empty on every side
BG = (250, 247, 242)          # --nh-sand, the PDP tile colour

_session = None


def session():
    global _session
    if _session is None:
        from rembg import new_session
        _session = new_session("isnet-general-use")
    return _session


def fetch(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 2000:
        return dest
    r = subprocess.run(["curl", "-s", "-L", "--max-time", "45", "-o", dest, url],
                       capture_output=True)
    return dest if os.path.exists(dest) and os.path.getsize(dest) > 2000 else None


def score_image(im):
    """Reject the listing photos that would look like a Chinese marketplace tile.

    Returns (ok, reason). The checks are deliberately blunt: they only have to
    separate a clean packshot from a collage or a text banner.
    """
    w, h = im.size
    if min(w, h) < 500:
        return False, "too small (%dx%d)" % (w, h)
    ar = w / float(h)
    if ar < 0.6 or ar > 1.7:
        return False, "extreme aspect %.2f" % ar

    g = im.convert("L")

    # A collage has hard full-width seams. Look for rows and columns that are
    # almost uniform and very different from their neighbours.
    a = np.asarray(g.resize((256, 256)), dtype=np.float32)
    row_std = a.std(axis=1)
    col_std = a.std(axis=0)
    seams = int((row_std < 3).sum() + (col_std < 3).sum())
    if seams > 190:
        return False, "looks like a collage/banner (%d flat lines)" % seams

    # Dense small-scale detail across the whole frame usually means overlaid
    # marketing text rather than a product on a plain ground.
    edges = np.asarray(g.filter(ImageFilter.FIND_EDGES).resize((256, 256)), dtype=np.float32)
    busy = float((edges > 40).mean())
    if busy > 0.34:
        return False, "busy/text-heavy frame (%.2f)" % busy

    return True, "ok"


def cutout(path):
    """Background-removed RGBA of the subject, or None if nothing solid is found."""
    from rembg import remove
    src = Image.open(path).convert("RGB")
    ok, why = score_image(src)
    if not ok:
        return None, why

    out = remove(src, session=session())
    rgba = out.convert("RGBA")
    alpha = np.asarray(rgba.getchannel("A"), dtype=np.uint8)

    covered = float((alpha > 24).mean())
    if covered < 0.045:
        return None, "cutout found almost nothing (%.3f)" % covered
    if covered > 0.93:
        return None, "cutout kept the whole frame (%.3f)" % covered

    # drop stray secondary blobs (a ghosted duplicate, a stray shadow) so the
    # tile holds one product rather than one product plus debris
    from scipy import ndimage as _nd
    mask = alpha > 24
    lab, n = _nd.label(mask)
    if n > 1:
        sizes = _nd.sum(mask, lab, range(1, n + 1))
        keep = sizes >= sizes.max() * 0.16
        allowed = set(i + 1 for i, k in enumerate(keep) if k)
        mask = np.isin(lab, list(allowed))
        alpha = np.where(mask, alpha, 0).astype(np.uint8)
        rgba.putalpha(Image.fromarray(alpha))

    ys, xs = np.where(alpha > 24)
    box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    sub = rgba.crop(box)

    # A real packshot is one object. Many scattered fragments means the photo was
    # a grid of several products.
    small = np.asarray(sub.getchannel("A").resize((64, 64)), dtype=np.uint8) > 24
    if small.sum() < 60:
        return None, "subject too sparse"

    return sub, "ok"


def compose(sub):
    """Fit the cut-out onto the standard warm-white square.

    Returns None when the subject would sit too small on the tile to read as
    the product, which happens when the source photo was mostly empty ground.
    """
    inner = int(CANVAS * (1 - 2 * MARGIN))
    w, h = sub.size
    scale = min(inner / float(w), inner / float(h))
    # never upscale a small subject past the point where it turns soft
    scale = min(scale, 2.2)
    nw, nh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))

    # the product has to own the tile; a stamp-sized bottle on a big square
    # reads as a mistake next to the rest of the catalogue
    if max(nw, nh) < inner * 0.72:
        return None

    sub = sub.resize((nw, nh), Image.LANCZOS)
    tile = Image.new("RGB", (CANVAS, CANVAS), BG)
    tile.paste(sub, ((CANVAS - nw) // 2, (CANVAS - nh) // 2), sub)
    return tile


def process(url, cache_dir, out_path):
    os.makedirs(cache_dir, exist_ok=True)
    name = str(abs(hash(url))) + ".img"
    raw = fetch(url, os.path.join(cache_dir, name))
    if not raw:
        return None, "download failed"
    try:
        sub, why = cutout(raw)
    except Exception as e:
        return None, "cutout error: %s" % e
    if sub is None:
        return None, why
    tile = compose(sub)
    tile.save(out_path, "JPEG", quality=88, optimize=True)
    return out_path, "ok"


if __name__ == "__main__":
    url, cache, out = sys.argv[1], sys.argv[2], sys.argv[3]
    p, why = process(url, cache, out)
    print(json.dumps({"out": p, "why": why}))
