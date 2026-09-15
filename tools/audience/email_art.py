# -*- coding: utf-8 -*-
"""Build the hero image for each of the thirteen September emails.

Composed locally from the real product cut-outs rather than generated, for one
reason that matters more than style: the product in the email is then pixel
identical to the product on the page and in the parcel. A generated image of a
real bottle redraws its label, and a redrawn label on a marketing email is a
misrepresentation, not a design choice.

Everything else is the store's own design language: the same warm sand ground as
the product tiles, the same bronze, the same espresso, so an email and a product
page look like one shop.
"""
import json, os, sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from bidi.algorithm import get_display

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import isolate

OUT = os.path.join(HERE, "email")
os.makedirs(OUT, exist_ok=True)

W, H = 1200, 600
SAND = (250, 247, 242)
ESPRESSO = (26, 26, 26)
BRONZE = (224, 122, 40)
MUTED = (107, 98, 89)
LINE = (232, 224, 214)

F = "C:/Windows/Fonts/"
FONTS = {
    "display": F + "FrankRuhlHofshi-Bold.otf",
    "head": F + "MiriamLibre-Bold.otf",
    "body": F + "MiriamLibre-Regular.otf",
    "num": F + "arial.ttf",
    "numb": F + "arialbd.ttf",
}


def font(kind, size):
    return ImageFont.truetype(FONTS[kind], size)


def heb(s):
    """Hebrew has to be reordered for a renderer that knows nothing about RTL."""
    return get_display(s)


def text(d, xy, s, f, fill, anchor="ra"):
    d.text(xy, heb(s), font=f, fill=fill, anchor=anchor)


def width(d, s, f):
    return d.textlength(heb(s), font=f)


_cache = {}


def cutout(tile_path):
    """RGBA of the product, keyed out of the finished store tile.

    Deliberately not re-derived from the original CJ photo. Several tiles were
    corrected by hand after that first pass, so the only image guaranteed to
    match what is live on the product page is the tile itself. Its ground is a
    known flat colour, which makes keying it out exact rather than a guess.
    """
    if tile_path in _cache:
        return _cache[tile_path]

    im = Image.open(tile_path).convert("RGB")
    a = np.asarray(im).astype(np.int16)
    dist = np.abs(a - np.array(SAND, dtype=np.int16)).sum(axis=2)

    alpha = np.clip((dist - 12) * 12, 0, 255).astype(np.uint8)
    # keep only what is connected to the product, so JPEG noise in the corners
    # does not survive as speckle
    from scipy import ndimage as nd
    solid = alpha > 140
    lab, n = nd.label(solid)
    if n:
        sizes = nd.sum(solid, lab, range(1, n + 1))
        keep = [i + 1 for i, sz in enumerate(sizes) if sz >= sizes.max() * 0.04]
        alpha = np.where(np.isin(lab, keep), alpha, 0).astype(np.uint8)

    rgba = im.convert("RGBA")
    rgba.putalpha(Image.fromarray(alpha))
    ys, xs = np.where(alpha > 24)
    if len(xs) == 0:
        _cache[tile_path] = rgba
        return rgba
    sub = rgba.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
    _cache[tile_path] = sub
    return sub


def place(canvas, sub, box, shadow=True):
    """Fit a product inside box=(x, y, w, h), sitting on a soft shadow."""
    bx, by, bw, bh = box
    w, h = sub.size
    scale = min(bw / float(w), bh / float(h))
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    s = sub.resize((nw, nh), Image.LANCZOS)
    x = bx + (bw - nw) // 2
    y = by + (bh - nh) // 2

    if shadow:
        # an ellipse under the product, not a drop shadow of its silhouette:
        # products stand on a surface and that is what the eye expects
        sh = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        sd = ImageDraw.Draw(sh)
        cx, cy = x + nw // 2, y + nh - int(nh * 0.02)
        rx, ry = int(nw * 0.42), max(6, int(nh * 0.045))
        sd.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=(120, 105, 90, 70))
        canvas.alpha_composite(sh.filter(ImageFilter.GaussianBlur(14)))

    canvas.alpha_composite(s, (x, y))
    return x, y, nw, nh


def ground():
    """The warm tile the whole store sits on, with one soft light from the left."""
    img = Image.new("RGBA", (W, H), SAND + (255,))
    g = Image.new("L", (W, H), 0)
    gd = ImageDraw.Draw(g)
    for i in range(70):
        a = int(16 * (1 - i / 70.0))
        gd.ellipse([-320 + i * 4, -260 + i * 3, 640 - i * 3, 560 - i * 2], fill=a)
    warm = Image.new("RGBA", (W, H), (255, 252, 246, 255))
    img.paste(warm, (0, 0), g.filter(ImageFilter.GaussianBlur(90)))
    return img


def money(n):
    """Whole shekels stay whole, anything else keeps both decimals. 69.3 is not
    a price anyone writes."""
    return "₪%d" % round(n) if abs(n - round(n)) < 0.005 else "₪%.2f" % n


def hero_single(row, out):
    """One product: text on the right, product on the left. Hebrew reads right first."""
    img = ground()
    d = ImageDraw.Draw(img)

    place(img, cutout(row["tile"]), (60, 70, 430, 460))

    rx = W - 70
    y = 132
    text(d, (rx, y), row["eyebrow"], font("head", 21), BRONZE)
    y += 44

    for line in row["headline"]:
        text(d, (rx, y), line, font("display", 47), ESPRESSO)
        y += 58

    y += 10
    for line in row.get("sub", []):
        text(d, (rx, y), line, font("body", 22), MUTED)
        y += 32

    y += 18
    now = money(row["now"])
    was = money(row["was"])
    fn = font("numb", 44)
    fw = font("num", 24)
    d.text((rx, y), now, font=fn, fill=ESPRESSO, anchor="ra")
    nw = d.textlength(now, font=fn)
    wx = rx - nw - 16
    d.text((wx, y + 16), was, font=fw, fill=MUTED, anchor="ra")
    ww = d.textlength(was, font=fw)
    d.line([wx - ww, y + 30, wx, y + 30], fill=MUTED, width=2)

    y += 74
    label = row.get("cta", "היום בלבד")
    fb = font("head", 20)
    tw = width(d, label, fb) + 52
    d.rounded_rectangle([rx - tw, y, rx, y + 50], radius=25, fill=BRONZE)
    text(d, (rx - tw / 2, y + 25), label, fb, (255, 255, 255), anchor="mm")

    img.convert("RGB").save(out, "JPEG", quality=90, optimize=True)


def hero_trio(row, out):
    """Three products: headline across the top, the row beneath, total under that."""
    img = ground()
    d = ImageDraw.Draw(img)

    cx = W // 2
    text(d, (cx, 54), row["eyebrow"], font("head", 21), BRONZE, anchor="ma")
    text(d, (cx, 90), row["headline"][0], font("display", 46), ESPRESSO, anchor="ma")
    if row.get("sub"):
        text(d, (cx, 152), row["sub"][0], font("body", 21), MUTED, anchor="ma")

    n = len(row["items"])
    slot = (W - 120) // n
    subs = [cutout(it["tile"]) for it in row["items"]]
    heights = [s_.size[1] / float(max(1, s_.size[0])) for s_ in subs]
    tallest = max(s_.size[1] for s_ in subs)
    for i, it in enumerate(row["items"]):
        x = 60 + i * slot
        # scale each to its own height, but never let one be less than 70% of
        # the tallest, or the row reads as a mistake rather than as real sizes
        rel = max(0.70, subs[i].size[1] / float(tallest))
        box_h = int(230 * rel)
        place(img, subs[i], (x + 14, 196 + (230 - box_h), slot - 28, box_h))
        mid = x + slot // 2
        text(d, (mid, 444), it["name"], font("head", 19), ESPRESSO, anchor="ma")
        pn = money(it["now"])
        pw = money(it["was"])
        fn = font("numb", 23)
        fw = font("num", 16)
        tw = d.textlength(pn, font=fn) + 10 + d.textlength(pw, font=fw)
        sx = mid + tw / 2
        d.text((sx, 474), pn, font=fn, fill=ESPRESSO, anchor="ra")
        wx = sx - d.textlength(pn, font=fn) - 10
        d.text((wx, 479), pw, font=fw, fill=MUTED, anchor="ra")
        d.line([wx - d.textlength(pw, font=fw), 488, wx, 488], fill=MUTED, width=2)

    total_now = sum(i["now"] for i in row["items"])
    total_was = sum(i["was"] for i in row["items"])
    label = "השגרה המלאה" if row.get("kind_label") == "bundle" else "שלושתם יחד"
    strip = "%s במקום %s  ·  %s" % (money(total_now), money(total_was), label)
    fb = font("head", 22)
    bw = width(d, strip, fb) + 64
    d.rounded_rectangle([cx - bw / 2, 520, cx + bw / 2, 572], radius=26, fill=ESPRESSO)
    text(d, (cx, 546), strip, fb, (255, 255, 255), anchor="mm")

    img.convert("RGB").save(out, "JPEG", quality=90, optimize=True)


if __name__ == "__main__":
    spec = json.load(open(os.path.join(HERE, "email_spec.json"), encoding="utf-8"))
    for row in spec:
        out = os.path.join(OUT, "%s.jpg" % row["slug"])
        if row["kind"] == "single":
            hero_single(row, out)
        else:
            hero_trio(row, out)
        print("  %-28s %s" % (row["slug"], row["headline"][0]))
    print("\n%d hero images" % len(spec))
