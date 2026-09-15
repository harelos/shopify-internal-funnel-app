# -*- coding: utf-8 -*-
"""Pull named files out of the live theme so edits start from what is actually
running, not from what the repo remembers.

Usage: python pull_theme.py sections/main-collection-banner.liquid ...

Writes into theme-live/ alongside theme-src/, so a diff between the two shows
what has drifted. Transport is curl for the same expired-CA-bundle reason as
push_theme.
"""
import json, os, subprocess, sys, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "theme-live")
SHOP, VER, TOKEN = os.environ["SHOP"], os.environ["VER"], os.environ["TOKEN"]


def rest(path):
    url = "https://%s/admin/api/%s/%s" % (SHOP, VER, path)
    p = subprocess.run(["curl", "-s", "-g", url,
                        "-H", "X-Shopify-Access-Token: " + TOKEN],
                       capture_output=True)
    # decode ourselves: Shopify returns valid UTF-8 but subprocess text mode on
    # this machine mangles it into lone surrogates
    return json.loads(p.stdout.decode("utf-8", "replace"))


def live_theme():
    main = [t for t in rest("themes.json")["themes"] if t["role"] == "main"]
    assert len(main) == 1, "expected exactly one live theme"
    return main[0]["id"]


def run(keys):
    tid = live_theme()
    print("live theme: %s" % tid)
    for key in keys:
        d = rest("themes/%s/assets.json?asset%%5Bkey%%5D=%s"
                 % (tid, urllib.parse.quote(key)))
        a = d.get("asset")
        if not a:
            print("  MISSING %s" % key)
            continue
        dest = os.path.join(OUT, key.replace("/", os.sep))
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "w", encoding="utf-8", newline="") as f:
            f.write(a.get("value") or "")
        print("  %-52s %6d bytes" % (key, len(a.get("value") or "")))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    run(sys.argv[1:])
