# -*- coding: utf-8 -*-
"""Upload binary files (images) into the live theme's assets.

Usage: python push_asset.py <local-path> <theme-key> [<local-path> <theme-key> ...]

The text pusher sends `value`; binaries have to go as base64 `attachment`, which
is why this is separate rather than another branch inside push_theme.
"""
import base64, json, os, subprocess, sys, urllib.parse

SHOP, VER, TOKEN = os.environ["SHOP"], os.environ["VER"], os.environ["TOKEN"]


def rest(method, path, payload=None):
    url = "https://%s/admin/api/%s/%s" % (SHOP, VER, path)
    args = ["curl", "-s", "-g", "-X", method, url,
            "-H", "X-Shopify-Access-Token: " + TOKEN]
    if payload is not None:
        args += ["-H", "Content-Type: application/json", "--data-binary", "@-"]
        p = subprocess.run(args, input=json.dumps(payload).encode("utf-8"),
                           capture_output=True)
    else:
        p = subprocess.run(args, capture_output=True)
    return json.loads(p.stdout.decode("utf-8", "replace"))


def live_theme():
    main = [t for t in rest("GET", "themes.json")["themes"] if t["role"] == "main"]
    assert len(main) == 1
    return main[0]["id"]


def run(pairs):
    tid = live_theme()
    print("live theme: %s" % tid)
    for local, key in pairs:
        data = base64.b64encode(open(local, "rb").read()).decode("ascii")
        r = rest("PUT", "themes/%s/assets.json" % tid,
                 {"asset": {"key": key, "attachment": data}})
        a = r.get("asset")
        if not a:
            print("  FAILED %-34s %s" % (key, json.dumps(r)[:160]))
            continue
        print("  %-34s %s bytes" % (key, a.get("size", "?")))


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args or len(args) % 2:
        raise SystemExit(__doc__)
    run(list(zip(args[0::2], args[1::2])))
