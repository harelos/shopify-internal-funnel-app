# -*- coding: utf-8 -*-
"""Put each generated frame next to the reference it was made from.

Checking a batch by looking only at the results does not work. The images are
plausible on their own; what goes wrong is which name they were filed under,
and that is invisible unless the reference is next to it. Two mislabellings got
through before this existed, and both were obvious the moment the pair was
shown side by side.
"""
import io, json, os, sys
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
SEL = json.load(io.open(os.path.join(HERE, "..", "raw5", "final50.json"), encoding="utf-8"))


def run(indices, frame="0_hero", out="_pairs.png"):
    pairs = [(i, os.path.join(HERE, "out", "%02d_%s.png" % (i, frame))) for i in indices]
    pairs = [(i, p) for i, p in pairs if os.path.exists(p)]
    if not pairs:
        print("nothing generated for those indices yet")
        return
    S = 300
    c = Image.new("RGB", (S * 2 * len(pairs), S + 24), "white")
    d = ImageDraw.Draw(c)
    for n, (i, p) in enumerate(pairs):
        c.paste(Image.open(SEL[i]["tile"]).convert("RGB").resize((S, S)), (n * 2 * S, 0))
        d.text((n * 2 * S + 6, S + 6), "ref %02d" % i, fill="black")
        c.paste(Image.open(p).convert("RGB").resize((S, S)), ((n * 2 + 1) * S, 0))
        d.text(((n * 2 + 1) * S + 6, S + 6), os.path.basename(p)[:-4], fill="black")
    c.save(os.path.join(HERE, out))
    print(os.path.join(HERE, out))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    run([int(x) for x in sys.argv[1:]])
