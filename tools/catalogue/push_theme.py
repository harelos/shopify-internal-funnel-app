# -*- coding: utf-8 -*-
"""Push named theme-src files to the live theme and verify them byte for byte.

Usage: python push_theme.py assets/nova-cart.js sections/nova-pdp.liquid ...

Uses curl for transport because this machine's Python CA bundle has expired and
fails verification against Shopify.
"""
import json, os, subprocess, sys, urllib.parse

SRC = r"C:\Users\Lenovo\Documents\Codex\2026-08-30\files-pasted-by-the-user-c\work\novahair-lifecycle-handoff\theme-src"
SHOP, VER, TOKEN = os.environ["SHOP"], os.environ["VER"], os.environ["TOKEN"]


def rest(method, path, payload=None):
    url = "https://%s/admin/api/%s/%s" % (SHOP, VER, path)
    args = ["curl", "-s", "-g", "-X", method, url, "-H", "X-Shopify-Access-Token: " + TOKEN]
    if payload is not None:
        args += ["-H", "Content-Type: application/json", "--data-binary", "@-"]
        out = subprocess.run(args, input=json.dumps(payload, ensure_ascii=False),
                             capture_output=True, text=True, encoding="utf-8",
                             errors="replace").stdout
    else:
        out = subprocess.run(args, capture_output=True, text=True, encoding="utf-8",
                             errors="replace").stdout
    return json.loads(out)


def live_theme():
    themes = rest("GET", "themes.json")["themes"]
    main = [t for t in themes if t["role"] == "main"]
    assert len(main) == 1, "expected exactly one live theme"
    return main[0]["id"]


def push(keys):
    tid = live_theme()
    print("live theme: %s" % tid)
    for key in keys:
        body = open(os.path.join(SRC, key.replace("/", os.sep)), encoding="utf-8").read()
        r = rest("PUT", "themes/%s/assets.json" % tid, {"asset": {"key": key, "value": body}})
        if "asset" not in r:
            # Shopify refuses a file with a Liquid error and leaves the old one
            # in place, so a silent failure here looks like a successful push
            print("  REJECTED %-34s %s" % (key, json.dumps(r, ensure_ascii=False)[:400]))
            continue
        print("  uploaded %-34s %s bytes" % (key, r["asset"].get("size")))

    print("\nverifying:")
    ok = True
    for key in keys:
        want = open(os.path.join(SRC, key.replace("/", os.sep)), encoding="utf-8").read()
        r = rest("GET", "themes/%s/assets.json?asset[key]=%s" % (tid, urllib.parse.quote(key)))
        got = r.get("asset", {}).get("value", "")
        if key.endswith(".json"):
            same = json.loads(got) == json.loads(want)   # Shopify pretty-prints JSON
        else:
            same = got.replace("\r\n", "\n") == want.replace("\r\n", "\n")
        ok = ok and same
        print("  %-34s %s" % (key, "MATCH" if same else "DIFFERS"))
    print("\nall match:", ok)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(push(sys.argv[1:]))
