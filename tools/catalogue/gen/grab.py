# -*- coding: utf-8 -*-
"""Move the newest ChatGPT download into the gallery folder under a real name.

ChatGPT names every download "ChatGPT Image <date>, <time>.png", so a folder of
them is unusable within about four files. This claims the newest one and files
it as <product index>_<frame>.png, which is the name the upload step expects.

It refuses to claim a file older than the cutoff, because the failure that
matters here is silent: if a generation failed and nothing new downloaded, the
previous product's image is sitting there and would be filed under this
product's name without anything looking wrong.
"""
import glob, hashlib, os, shutil, sys, time

DL = os.path.join(os.path.expanduser("~"), "Downloads")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")


def newest(max_age_s=180):
    files = [f for f in glob.glob(os.path.join(DL, "ChatGPT Image*.png"))]
    if not files:
        return None, "no ChatGPT download found"
    f = max(files, key=os.path.getmtime)
    age = time.time() - os.path.getmtime(f)
    if age > max_age_s:
        return None, "newest download is %.0fs old, older than the %ds cutoff" % (age, max_age_s)
    return f, None


def fingerprints():
    """Content hashes of everything already filed, so a repeat is visible."""
    out = {}
    for f in glob.glob(os.path.join(OUT, "*.png")):
        out[hashlib.sha1(open(f, "rb").read()).hexdigest()] = os.path.basename(f)
    return out


def claim(name):
    """Take the newest download, unless it is stale or we already have it.

    The duplicate check is the one that matters. The age cutoff catches a
    download that never happened; this catches a download that happened twice,
    which is what a re-click on an already-saved image produces and what filed
    one product's bottle under another product's name. Identical bytes cannot be
    two different products.
    """
    f, why = newest()
    if not f:
        return None, why
    digest = hashlib.sha1(open(f, "rb").read()).hexdigest()
    seen = fingerprints()
    if digest in seen:
        return None, "these exact bytes are already filed as %s" % seen[digest]
    dest = os.path.join(OUT, name + ".png")
    shutil.move(f, dest)
    return dest, None


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    dest, why = claim(sys.argv[1])
    print(("claimed -> " + dest) if dest else ("SKIPPED: " + why))


# A note for the next run, written after getting this wrong by hand.
#
# The 180 second cutoff is not a nuisance, it is the only thing standing between
# a slow click and a mislabelled catalogue. When "all images in this series" was
# used to download a three-up batch, only one file arrived, the cutoff refused
# it because the clicking had taken seven minutes, and it was overridden by hand
# on the assumption that the one file must be the right one. It was not. It was
# the previous product's bottle, and it went into the catalogue under the next
# product's name, where nothing would have flagged it.
#
# Regenerate instead of overriding. The cost of a regeneration is ninety
# seconds. The cost of a wrong product photograph is a customer opening a parcel
# that does not match what she bought.
