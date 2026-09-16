# -*- coding: utf-8 -*-
"""Run the wave-1 image filter over the wave-2 picks.

Reused unchanged on purpose. The filter's job is to find the one frame in a CJ
image set that is a single product on a plain ground, with no person and no
overlaid advertising, and that job did not change because the product is now a
scarf instead of a bottle. What did change is how much it matters: a scarf
listing's lifestyle frames are styled as hijab, so the same filter that used to
protect the store from marketplace clutter is now also what keeps the wrong
cultural framing off the shelf.

A listing whose entire set is styled or modelled is dropped, not patched.
"""
import io, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_tiles

HERE = os.path.dirname(os.path.abspath(__file__))

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    picks = json.load(io.open(os.path.join(HERE, "raw5", "picks5.json"), encoding="utf-8"))
    build_tiles.run(picks, os.path.join(HERE, "raw5", "tiled5.json"))
