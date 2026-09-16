# -*- coding: utf-8 -*-
"""The image system: four frames per product, one house style across all of them.

Harel's brief, in his words: no carton, no packet, only the bottle or the
product itself; it has to look the same everywhere so the shelf reads as one
brand; and it should not be plastic-perfect, because a real Amazon listing
never is.

Those two last points pull against each other, so the split is deliberate. The
STYLE block is identical in every prompt and never varies: same ground, same
light, same camera height, same colour temperature. That is what makes forty
four products from forty four different Chinese sellers look like one shelf.
The variation lives entirely inside the four frames, which is where a shopper
expects it.

    1  hero     the product alone, square on. This is the grid thumbnail, and
                it is the only frame that is allowed to be perfect.
    2  texture  what the thing actually feels like. A cream shows a swirl, a
                toner shows a drop and its meniscus. Shoppers scroll to this
                one to decide whether it is greasy.
    3  in use   a hand, mid-application, slightly off-centre. No face, because
                a face makes it a model shot and invites the question of who
                she is.
    4  context  the product where it lives, on a bathroom ledge. Room in the
                frame for Hebrew text, which is composed locally afterwards.

On the fourth frame and Hebrew: image models render Hebrew as broken glyphs,
reliably and without warning. So nothing in these prompts asks for text of any
kind. Frame 4 is generated as a clean plate with deliberate empty space, and
the Hebrew benefit lines are drawn over it in `benefits.py`, where the glyphs
are real and the line breaks are ours.

The reference image is attached to every single prompt. Without it the model
invents a plausible bottle that is not the bottle the customer receives, and
the first thing they do on arrival is compare.
"""

# Never varies. This is the whole reason the catalogue looks like one brand.
STYLE = (
    "Studio product photography. Seamless warm off-white background, the same "
    "soft cream tone in every shot. One large diffused softbox high and to the "
    "left, giving a soft natural falloff and a short soft shadow under the "
    "product. Neutral daylight white balance. Shot on a 100mm macro at f/5.6, "
    "camera at product height, no wide-angle distortion. Colours true to the "
    "reference, no colour grading, no vignette."
)

# What must never appear, in any frame.
NEVER = (
    "Do not include the carton, the box, the outer packaging, or any secondary "
    "packaging. Show only the bottle, tube, jar or object itself. No text, no "
    "captions, no logos added, no watermark, no labels invented, no badges, no "
    "borders, no collage, no split frames, no before and after."
)

# The instruction that makes the model copy the real product rather than invent one.
FIDELITY = (
    "The attached photograph is the real product. Reproduce THIS product "
    "exactly: its shape, its proportions, its cap, its colour, and the artwork "
    "and lettering already printed on it. Do not redesign the bottle and do not "
    "restyle its label. If the attached photograph shows the product next to "
    "its box, use only the product and discard the box entirely."
)

FRAMES = [
    ("hero",
     "A single clean pack shot of the product, centred, upright, square to the "
     "camera, filling about seventy percent of the frame. Nothing else in shot."),

    ("texture",
     "The product standing slightly off-centre, with a generous sample of its "
     "own texture on the surface beside it: {texture}. The texture is the "
     "subject as much as the bottle is. Shallow depth of field so the texture "
     "is crisp and the bottle falls gently soft."),

    ("inuse",
     "A woman's hand, natural unretouched skin, short neutral manicure, caught "
     "mid-use: {gesture}. The hand enters from the right. Frame is slightly "
     "off-centre and a little imperfect, the way a real listing photo is. No "
     "face, no arm above the wrist, no jewellery."),

    ("context",
     "The product standing on a pale stone bathroom ledge, shot from slightly "
     "above, positioned in the lower left of the frame. A soft out-of-focus "
     "warm highlight behind it. Deliberately leave the upper right two thirds "
     "of the frame clean and empty. No props, no towels, no plants, no text."),
]

# shelf -> how its texture reads, and what the hand is doing with it
BY_SHELF = {
    "לחות": dict(
        texture="a thick glossy swirl of white cream with soft peaks",
        gesture="scooping a small amount of the cream onto a fingertip"),
    "טונר ומיסט": dict(
        texture="a shallow clear pool of liquid with a visible meniscus, and a "
                "saturated round cotton pad resting at its edge",
        gesture="pressing a damp cotton pad flat against the palm"),
    "סרום ואמפולה": dict(
        texture="three or four clear viscous droplets holding their domed shape",
        gesture="holding the dropper just above the palm with one drop hanging"),
    "כלים": dict(
        texture="the stone resting on its side so its full profile and polished "
                "edge are visible, with a light sheen of clear facial oil on it",
        gesture="holding the stone at the angle it is used against the cheek"),
    "פילינג": dict(
        texture="a thin translucent gel spread into a wide even film, catching "
                "the light at its edge",
        gesture="spreading a thin film of the gel across the fingertips"),
    "פצעונים": dict(
        texture="a sheet of small clear round patches, one lifted at its corner",
        gesture="lifting a single clear patch on a fingertip"),
}


def build(shelf, frame_index):
    """The full prompt for one frame of one product."""
    name, body = FRAMES[frame_index]
    detail = BY_SHELF.get(shelf, BY_SHELF["לחות"])
    return "%s\n\n%s\n\n%s\n\n%s\n\nSquare 1:1 image." % (
        FIDELITY, body.format(**detail), STYLE, NEVER)


def all_frames(shelf):
    return [(FRAMES[i][0], build(shelf, i)) for i in range(len(FRAMES))]


if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    for nm, p in all_frames("טונר ומיסט"):
        print("=== %s ===\n%s\n" % (nm, p))
