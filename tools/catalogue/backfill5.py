# -*- coding: utf-8 -*-
"""Tile the whole eligible pool, not just a pre-chosen fifty.

62% of the first fifty were dropped by the image filter, because a large share
of CJ skincare listings are marketing banners end to end: before-and-after
grids, ingredient bubbles, English advertising set over the bottle. Choosing
fifty first and tiling second therefore chooses for demand and then discovers
whether a picture exists, which is backwards.

So: tile everything that cleared the demand bar, and let the selection run over
what actually has a photograph the store can use.
"""
import io, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_tiles

HERE = os.path.dirname(os.path.abspath(__file__))

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    pool = json.load(io.open(os.path.join(HERE, "raw5", "strong5.json"), encoding="utf-8"))
    done = {r["pid"] for r in
            json.load(io.open(os.path.join(HERE, "raw5", "tiled5.json"), encoding="utf-8"))}
    tried = {r["pid"] for r in
             json.load(io.open(os.path.join(HERE, "raw5", "picks5.json"), encoding="utf-8"))}
    todo = [r for r in pool if r["pid"] not in tried]
    print("pool %d, already tiled %d, still to try %d\n" % (len(pool), len(done), len(todo)))
    more = build_tiles.run(todo, os.path.join(HERE, "raw5", "tiled5_more.json"))
