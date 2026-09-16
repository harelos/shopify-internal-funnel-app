# -*- coding: utf-8 -*-
"""Push theme-src files into a named theme, not necessarily the live one.

push_theme.py always targets whichever theme has role main, which is right for
shipping and wrong for previewing. The review work has to land somewhere only
Harel can open, so this takes an explicit theme id and refuses to guess.

    python push_to_theme.py 188482584871 sections/nova-reviews.liquid ...

It will not write to the live theme. Passing the main theme's id is treated as
a mistake rather than as intent, because the whole reason this file exists is
to keep demonstration content off the storefront, and a mistyped id is exactly
how that protection would fail.
"""
import json, os, subprocess, sys

SRC = os.path.join(os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__)))), "theme-src")
SHOP, VER, TOKEN = os.environ["SHOP"], os.environ["VER"], os.environ["TOKEN"]


def rest(method, path, payload=None):
    url = "https://%s/admin/api/%s/%s" % (SHOP, VER, path)
    args = ["curl", "-s", "-g", "-X", method, url,
            "-H", "X-Shopify-Access-Token: " + TOKEN]
    if payload is not None:
        args += ["-H", "Content-Type: application/json", "--data-binary", "@-"]
        out = subprocess.run(args, input=json.dumps(payload, ensure_ascii=False),
                             capture_output=True, text=True, encoding="utf-8",
                             errors="replace").stdout
    else:
        out = subprocess.run(args, capture_output=True, text=True,
                             encoding="utf-8", errors="replace").stdout
    try:
        return json.loads(out)
    except Exception:
        return {"_raw": out[:400]}


def themes():
    return rest("GET", "themes.json").get("themes", [])


def put(theme_id, key, value):
    return rest("PUT", "themes/%s/assets.json" % theme_id,
                {"asset": {"key": key, "value": value}})


def get(theme_id, key):
    import urllib.parse
    d = rest("GET", "themes/%s/assets.json?asset[key]=%s"
             % (theme_id, urllib.parse.quote(key, safe="")))
    return (d.get("asset") or {}).get("value")


def run(theme_id, keys):
    all_themes = themes()
    main = [t for t in all_themes if t["role"] == "main"]
    if main and str(main[0]["id"]) == str(theme_id):
        sys.exit("refusing: %s is the live theme. This tool is for previews." % theme_id)
    named = [t for t in all_themes if str(t["id"]) == str(theme_id)]
    if not named:
        sys.exit("no theme with id %s" % theme_id)
    print("target: %s (%s)\n" % (named[0]["name"], theme_id))

    for key in keys:
        path = os.path.join(SRC, key.replace("/", os.sep))
        if not os.path.exists(path):
            print("  MISSING %s" % key)
            continue
        with open(path, encoding="utf-8") as fh:
            value = fh.read()
        d = put(theme_id, key, value)
        if "asset" not in d:
            print("  FAILED  %-42s %s" % (key, str(d)[:120]))
            continue
        # verify on content, not on the response, and normalise line endings
        # because the API rewrites CRLF and a naive compare reports a false diff
        back = get(theme_id, key) or ""
        same = back.replace("\r\n", "\n") == value.replace("\r\n", "\n")
        print("  %-7s %-42s %d bytes" % ("OK" if same else "DIFFERS", key, len(value)))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    run(sys.argv[1], sys.argv[2:])
