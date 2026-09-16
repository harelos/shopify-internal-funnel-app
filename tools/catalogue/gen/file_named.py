# -*- coding: utf-8 -*-
"""File downloads that arrived under a name we chose, not a name ChatGPT chose.

The click-the-menu route names every file "ChatGPT Image <date>.png", which
forces grab.py to identify files by age and makes a slow click enough to
misfile one. Driving the download from inside the page instead lets the file
arrive as nova_<index>.png, so identification is by name and the whole class of
timing bug disappears.

The pattern is anchored to exactly two digits on purpose. A first attempt used
`nova_*.png` and swept up `nova_ad_862.png`, an unrelated file that happened to
be sitting in the same folder, and filed it as a product photograph. The folder
is shared with another agent's session, so a loose glob there is not a
theoretical risk.
"""
import os, re, shutil, sys

DL = os.path.join(os.path.expanduser("~"), "Downloads")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
PATTERN = re.compile(r"^nova_(\d{2})\.png$")


def run(frame="0_hero"):
    filed = []
    for name in os.listdir(DL):
        m = PATTERN.match(name)
        if not m:
            continue
        dest = os.path.join(OUT, "%s_%s.png" % (m.group(1), frame))
        shutil.move(os.path.join(DL, name), dest)
        filed.append(os.path.basename(dest))
    for f in sorted(filed):
        print("filed", f)
    print("%d filed" % len(filed))
    return filed


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    run(sys.argv[1] if len(sys.argv) > 1 else "0_hero")
