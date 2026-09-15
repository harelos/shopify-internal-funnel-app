# -*- coding: utf-8 -*-
"""Walk the live storefront and fail loudly on anything broken.

Checks every URL the navigation can reach, every mission collection, the pages
the funnel lives on, and a sample of product pages. A restructure that deletes
collections and rewrites two menus is exactly the kind of change that leaves a
404 somewhere nobody looks, so this looks.
"""
import json, os, re, subprocess, sys, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import shopify

BASE = "https://tigerbrandsglobal.com"

MENUS = """
{ menus(first: 30) { nodes { handle
    items { title url items { title url items { title url } } } } } }"""

COLS = "{ collections(first: 100) { nodes { handle title productsCount { count } } } }"
PRODS = '{ products(first: 250, query: "status:active") { nodes { handle } } }'


def head(url):
    p = subprocess.run(["curl", "-s", "-o", os.devnull, "-w", "%{http_code}",
                        "-L", "--max-time", "20", url], capture_output=True, text=True)
    return p.stdout.strip()


def body(url):
    p = subprocess.run(["curl", "-s", "-L", "--max-time", "25", url], capture_output=True)
    return p.stdout.decode("utf-8", "replace")


def run():
    fails, checked = [], 0

    print("=" * 62)
    print("1. every link in every menu")
    urls = set()
    for m in shopify.gql(MENUS)["menus"]["nodes"]:
        def walk(items):
            for it in items:
                u = it.get("url") or ""
                if u.startswith(BASE) or u.startswith("/"):
                    urls.add(u if u.startswith("http") else BASE + u)
                walk(it.get("items") or [])
        walk(m["items"])
    for u in sorted(urls):
        c = head(u)
        checked += 1
        short = urllib.parse.unquote(u.replace(BASE, "")) or "/"
        if c != "200":
            fails.append((short, c))
            print("  FAIL %-3s %s" % (c, short))
    print("  %d menu links, %d bad" % (len(urls), len([f for f in fails])))

    print()
    print("2. every collection, and its product count on the page")
    cols = shopify.gql(COLS)["collections"]["nodes"]
    for c in sorted(cols, key=lambda r: r["handle"]):
        if c["handle"] == "frontpage":
            continue
        u = "%s/collections/%s" % (BASE, urllib.parse.quote(c["handle"]))
        code = head(u)
        checked += 1
        if code != "200":
            fails.append((c["handle"], code))
            print("  FAIL %-3s %s" % (code, c["handle"]))
            continue
        html = body(u)
        m = re.search(r"(\d+)\s*מוצרים", html)
        shown = int(m.group(1)) if m else None
        flag = ""
        if shown is not None and shown != c["productsCount"]["count"]:
            flag = "  <-- admin says %d" % c["productsCount"]["count"]
            fails.append((c["handle"], "count %s vs %s" % (shown, c["productsCount"]["count"])))
        print("  ok  %-30s %s on page%s" % (c["handle"][:30], shown, flag))

    print()
    print("3. the pages the funnel and the campaign live on")
    for path in ["/", "/pages/deals", "/pages/novahair-sales-staging",
                 "/pages/novahair", "/pages/tiger-club", "/pages/contact",
                 "/collections/all", "/cart"]:
        c = head(BASE + path)
        checked += 1
        if c != "200":
            fails.append((path, c))
        print("  %-4s %s" % (c, path))

    print()
    print("4. a sample of product pages")
    handles = [p["handle"] for p in shopify.gql(PRODS)["products"]["nodes"]]
    sample = handles[:6] + handles[-6:]
    for h in sample:
        c = head("%s/products/%s" % (BASE, urllib.parse.quote(h)))
        checked += 1
        if c != "200":
            fails.append((h, c))
            print("  FAIL %-3s %s" % (c, h))
    print("  %d product pages sampled from %d active" % (len(sample), len(handles)))

    print()
    print("=" * 62)
    if fails:
        print("FAILURES: %d of %d checks" % (len(fails), checked))
        for what, why in fails:
            print("  %-46s %s" % (urllib.parse.unquote(str(what))[:46], why))
        sys.exit(1)
    print("all %d checks passed" % checked)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    run()
