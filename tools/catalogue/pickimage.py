"""Choose the one photo in a CJ image set that can sit on the store.

CJ's first image is almost always a marketing banner: a model, a before/after
pair, ingredient bubbles, English advertising copy. Somewhere further down the
set there is usually a plain packshot. This scores every image in the set and
returns the best packshot, or nothing when the listing has none.

The store then gets the subject cut out and dropped on a uniform tile, so what
matters here is only: is this one product on a plain ground, with no people and
no overlaid advertising.
"""
import os, subprocess

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

CACHE = None


def fetch(url, cache_dir):
    os.makedirs(cache_dir, exist_ok=True)
    key = url.rsplit("/", 1)[-1].split("?")[0]
    if not key or len(key) < 6:
        key = str(abs(hash(url)))
    dest = os.path.join(cache_dir, key)
    if not dest.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
        dest += ".jpg"
    if os.path.exists(dest) and os.path.getsize(dest) > 3000:
        return dest
    subprocess.run(["curl", "-s", "-L", "--max-time", "40", "-o", dest, url],
                   capture_output=True)
    if os.path.exists(dest) and os.path.getsize(dest) > 3000:
        return dest
    return None


def skin_fraction(rgb):
    """Rough share of the frame that reads as human skin.

    A packshot has essentially none. A model shot, a hand holding a bottle or a
    before/after scalp photo has a lot, and all three are wrong for this store.
    """
    a = np.asarray(rgb.resize((200, 200)), dtype=np.int16)
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    mx = a.max(axis=2)
    mn = a.min(axis=2)
    rule = ((r > 95) & (g > 40) & (b > 20) & ((mx - mn) > 15) &
            (np.abs(r - g) > 15) & (r > g) & (r > b))
    # a second pass in YCbCr catches darker skin the RGB rule misses
    y = 0.299 * r + 0.587 * g + 0.114 * b
    cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
    cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b
    rule2 = (y > 60) & (cb > 77) & (cb < 127) & (cr > 133) & (cr < 173)
    return float((rule | rule2).mean())


def corner_plainness(rgb):
    """How close the four corners are to one flat colour. A packshot scores high."""
    a = np.asarray(rgb.resize((200, 200)), dtype=np.float32)
    k = 30
    patches = [a[:k, :k], a[:k, -k:], a[-k:, :k], a[-k:, -k:]]
    means = np.array([p.reshape(-1, 3).mean(axis=0) for p in patches])
    spread = float(np.abs(means - means.mean(axis=0)).mean())
    inner_std = float(np.mean([p.std() for p in patches]))
    brightness = float(means.mean())
    plain = 1.0 - min(1.0, (spread / 18.0 + inner_std / 25.0) / 2.0)
    if brightness > 225:
        plain += 0.25                      # white sweep, the ideal case
    return max(0.0, min(1.35, plain))


def text_busyness(rgb):
    """Small-scale edge density, which overlaid marketing copy drives up."""
    g = rgb.convert("L").resize((256, 256))
    e = np.asarray(g.filter(ImageFilter.FIND_EDGES), dtype=np.float32)
    return float((e > 45).mean())


def collage_seams(rgb):
    """Count near-uniform rows and columns, the signature of a tiled grid."""
    a = np.asarray(rgb.convert("L").resize((256, 256)), dtype=np.float32)
    return int((a.std(axis=1) < 3).sum() + (a.std(axis=0) < 3).sum())


def subject_box(rgb):
    """Rough bounding box of the product, found by difference from the background.

    Cheap stand-in for a cutout, used only to decide whether text sits on the
    product (a printed label, which is fine) or floats on the empty ground
    beside it (a spec sheet or an advertising overlay, which is not).
    """
    a = np.asarray(rgb.resize((256, 256)), dtype=np.float32)
    corners = np.concatenate([
        a[:24, :24].reshape(-1, 3), a[:24, -24:].reshape(-1, 3),
        a[-24:, :24].reshape(-1, 3), a[-24:, -24:].reshape(-1, 3)])
    bgc = corners.mean(axis=0)
    diff = np.abs(a - bgc).sum(axis=2)
    mask = diff > 42
    if mask.sum() < 60:
        return None
    ys, xs = np.where(mask)
    # 2nd/98th percentile, so a few stray specks do not inflate the box
    y0, y1 = np.percentile(ys, 1), np.percentile(ys, 99)
    x0, x1 = np.percentile(xs, 1), np.percentile(xs, 99)
    return (x0 / 256.0, y0 / 256.0, x1 / 256.0, y1 / 256.0)


def glyph_count(rgb):
    """Count text-like marks, and how many of them sit off the product.

    A printed label on a bottle is normal and desirable. Lines of English copy
    laid out on the empty white around the product are what this store must not
    show, so the second number is the one that decides.
    """
    N = 800
    g = np.asarray(rgb.convert("L").resize((N, N)), dtype=np.uint8)
    # local threshold, so a dark bottle is not mistaken for a block of text
    bg = ndimage.uniform_filter(g.astype(np.float32), size=41)
    dark = (bg - g.astype(np.float32)) > 28

    lab, n = ndimage.label(dark)
    if n == 0:
        return 0, 0, 0.0
    objs = ndimage.find_objects(lab)

    box = subject_box(rgb)
    if box:
        bx0, by0, bx1, by1 = [v * N for v in box]
        pad = N * 0.03
        bx0, by0, bx1, by1 = bx0 - pad, by0 - pad, bx1 + pad, by1 + pad
    else:
        bx0 = by0 = 0.0
        bx1 = by1 = float(N)

    total, outside, heights = 0, 0, []
    for sl in objs:
        h = sl[0].stop - sl[0].start
        w = sl[1].stop - sl[1].start
        if not (6 <= h <= 46 and 3 <= w <= 60 and w * h >= 18):
            continue
        ar = w / float(h)
        if not (0.12 <= ar <= 4.0):
            continue
        total += 1
        heights.append(h)
        cy = (sl[0].start + sl[0].stop) / 2.0
        cx = (sl[1].start + sl[1].stop) / 2.0
        if not (bx0 <= cx <= bx1 and by0 <= cy <= by1):
            outside += 1

    if not heights:
        return 0, 0, 0.0
    hv = np.array(heights, dtype=np.float32)
    uniformity = 1.0 - min(1.0, float(hv.std()) / max(1.0, float(hv.mean())))
    return total, outside, uniformity


def score(path):
    try:
        im = Image.open(path).convert("RGB")
    except Exception as e:
        return None, 0.0, "unreadable: %s" % e

    w, h = im.size
    if min(w, h) < 480:
        return im, -99, "too small %dx%d" % (w, h)
    ar = w / float(h)
    if ar < 0.7 or ar > 1.45:
        return im, -99, "aspect %.2f" % ar

    skin = skin_fraction(im)
    plain = corner_plainness(im)
    busy = text_busyness(im)
    seams = collage_seams(im)
    glyphs, glyphs_out, guni = glyph_count(im)

    s = 0.0
    s += plain * 40.0
    s -= skin * 260.0                      # people are the single worst signal
    s -= max(0.0, busy - 0.10) * 150.0
    s -= max(0, seams - 60) * 0.35
    if skin > 0.10:
        return im, -99, "people/skin %.2f" % skin
    if busy > 0.33:
        return im, -99, "text heavy %.2f" % busy
    if seams > 200:
        return im, -99, "collage %d" % seams
    if plain < 0.25:
        return im, -99, "busy background %.2f" % plain
    # Text printed on the product is a label. Text laid out on the empty ground
    # beside it is a spec sheet or an advertising overlay, which is the thing
    # this store must never show.
    if glyphs_out >= 40 and guni > 0.40:
        return im, -99, "text laid on the background (%d marks)" % glyphs_out
    if glyphs_out >= 75:
        return im, -99, "text laid on the background (%d marks)" % glyphs_out

    s -= max(0, glyphs_out - 8) * 1.4
    s -= max(0, glyphs - 60) * 0.25

    why = "plain=%.2f skin=%.2f busy=%.2f seams=%d glyph=%d/out=%d" % (
        plain, skin, busy, seams, glyphs, glyphs_out)
    return im, s, why


def best(urls, cache_dir, limit=6):
    """Return (local_path, score, why) for the best packshot, or (None, ...).

    Position matters as much as cleanliness. CJ lists the product itself first
    and pads the tail of the set with accessories, bundle shots and whatever
    else ships in the box, so a spotless photo at position five is more likely
    to be a free gift than the thing being sold.
    """
    ranked = []
    for idx, u in enumerate(urls[:limit]):
        p = fetch(u, cache_dir)
        if not p:
            continue
        im, s, why = score(p)
        if im is None or s <= -90:
            continue
        s -= idx * 9.0
        why = "#%d %s" % (idx + 1, why)
        ranked.append((s, p, why))
    if not ranked:
        return None, -99, "no usable packshot in set"
    ranked.sort(key=lambda t: -t[0])
    s, p, why = ranked[0]
    return p, s, why
