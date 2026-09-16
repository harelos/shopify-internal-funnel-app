# -*- coding: utf-8 -*-
"""Draw the Hebrew benefit chips onto the fourth gallery frame, locally.

Image models render Hebrew as broken glyphs. Not occasionally, and not with a
warning: they produce letter shapes that look like Hebrew to someone who does
not read it and are nonsense to someone who does, which is the worst possible
failure for a storefront aimed at Israelis. So none of the generation prompts
ask for text at all. Frame 4 is generated as a clean plate with its upper right
two thirds deliberately empty, and the words are drawn here, where the glyphs
are real and the line breaks are ours.

Two details that decide whether this looks native or machine-made.

DIRECTION. Pillow has no bidi support unless it was built against libraqm, and
this machine's was not. Drawing a Hebrew string straight to the canvas prints it
left to right, so the letters are right and the reading order is reversed.
`python-bidi` resolves the visual order first, which is what the canvas actually
needs. Without it every line reads backwards, and it still looks plausible at a
glance, so nothing catches it.

CONTENT. The chips are the product's own tags, minus the first one. The first
tag is the category, which is already the product title and would just repeat
it. The rest are short, concrete and already reviewed as customer-facing Hebrew,
so nothing new is invented at the point where nobody would be checking it.
"""
import io, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from PIL import Image, ImageDraw, ImageFont
from bidi.algorithm import get_display

FONT_DIR = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")
FONT_BODY = os.path.join(FONT_DIR, "segoeui.ttf")
FONT_BOLD = os.path.join(FONT_DIR, "segoeuib.ttf")

INK = (29, 26, 23)
MUTED = (109, 102, 94)
RULE = (214, 205, 193)


def rtl(text):
    """Hebrew in the visual order a non-bidi canvas needs."""
    return get_display(text)


def draw_chips(plate_path, lines, out_path, title=None):
    im = Image.open(plate_path).convert("RGB")
    W, H = im.size
    d = ImageDraw.Draw(im)

    # the plate reserves the upper right; text is right aligned into it
    right = int(W * 0.92)
    top = int(H * 0.12)
    size_title = max(28, W // 26)
    size_body = max(22, W // 34)
    f_title = ImageFont.truetype(FONT_BOLD, size_title)
    f_body = ImageFont.truetype(FONT_BODY, size_body)

    y = top
    if title:
        t = rtl(title)
        w = d.textlength(t, font=f_title)
        d.text((right - w, y), t, font=f_title, fill=INK)
        y += int(size_title * 1.5)
        d.line([(right - int(W * 0.10), y), (right, y)], fill=RULE, width=2)
        y += int(size_body * 0.9)

    for line in lines:
        t = rtl(line)
        w = d.textlength(t, font=f_body)
        # a small filled dot sits to the right of the text, which is where a
        # bullet belongs when the line reads right to left
        dot_r = max(3, size_body // 8)
        d.ellipse([right - dot_r * 2, y + size_body // 2 - dot_r,
                   right, y + size_body // 2 + dot_r], fill=MUTED)
        d.text((right - w - dot_r * 3.2, y), t, font=f_body, fill=INK)
        y += int(size_body * 1.85)

    im.save(out_path, "PNG")
    return out_path


def chips_for(item):
    """The product's own tags, minus the category one that repeats the title."""
    return [t for t in item["tags"][1:4]]


def run():
    import copy_glow
    plates = {f.split("_")[0]: os.path.join(HERE, "out", f)
              for f in os.listdir(os.path.join(HERE, "out"))
              if f.endswith("_3_context.png")}
    if not plates:
        print("no context plates generated yet, nothing to compose")
        print("this step runs after frame 4 exists for a product")
        return
    made = 0
    for it in copy_glow.ALL:
        key = "%02d" % it["src"]
        if key not in plates:
            continue
        out = os.path.join(HERE, "out", "%s_3_benefits.png" % key)
        draw_chips(plates[key], chips_for(it), out,
                   title=it["title"].split(" - ", 1)[1])
        made += 1
        print("composed %s  %s" % (key, " · ".join(chips_for(it))))
    print("\ncomposed %d benefit frames" % made)


def selftest():
    """Prove the direction fix on a blank plate before any plate exists."""
    plate = Image.new("RGB", (1254, 1254), (251, 249, 246))
    p = os.path.join(HERE, "_bidi_plate.png")
    plate.save(p)
    out = draw_chips(p, ["חומצה גליקולית", "לעור מעורב", "שימוש ערב"],
                     os.path.join(HERE, "_bidi_selftest.png"),
                     title="טונר גליקולי")
    os.remove(p)
    print("wrote", out)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if "--selftest" in sys.argv:
        selftest()
    else:
        run()
