# -*- coding: utf-8 -*-
"""Retire the six empty k-beauty collections, without leaving six 404s.

The 33 products in them were archived on 14 Sep 2026 and given 301s, but the
collection URLs were left published, so the shelf is six live pages with nothing
on them. Google has had months to index those URLs.

So the order matters: create the redirect first, then delete. A redirect is
inert while the collection still resolves, and takes over the moment it does
not, which means there is no window where the URL 404s.

Each collection goes to the nearest live equivalent rather than all to the
homepage, because a redirect to a relevant shelf keeps whatever authority the
URL earned and a redirect to the homepage throws it away.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import shopify

# k-beauty handle -> the mission that best answers the same intent
TARGETS = {
    "k-beauty": "mission-serums",                    # the face shelf in general
    "k-beauty-glow-tone": "mission-serums",          # brightening, evenness
    "k-beauty-hydration-barrier": "mission-serums",  # hydration
    "k-beauty-pores-texture": "mission-serums",      # texture
    "k-beauty-snail-routine": "mission-night",       # overnight repair
    "k-beauty-cleanse-sun": "mission-protect",       # sun protection
}

FIND = """
query c($q: String!) { collections(first: 20, query: $q) {
  nodes { id handle title products(first: 1) { nodes { status } } } } }"""

REDIRECTS = "{ urlRedirects(first: 250) { nodes { id path target } } }"

MAKE = """
mutation r($redirect: UrlRedirectInput!) {
  urlRedirectCreate(urlRedirect: $redirect) {
    urlRedirect { id path target }
    userErrors { field message }
  }
}"""

DELETE = """
mutation d($input: CollectionDeleteInput!) {
  collectionDelete(input: $input) { deletedCollectionId userErrors { field message } }
}"""


def run(apply=False):
    q = " OR ".join("handle:%s" % h for h in TARGETS)
    cols = {c["handle"]: c for c in shopify.gql(FIND, {"q": q})["collections"]["nodes"]
            if c["handle"] in TARGETS}

    live_targets = {c["handle"] for c in
                    shopify.gql(FIND, {"q": " OR ".join(
                        "handle:%s" % t for t in set(TARGETS.values()))})["collections"]["nodes"]}

    existing = {r["path"] for r in shopify.gql(REDIRECTS)["urlRedirects"]["nodes"]}

    print("%-30s %-8s %s" % ("collection", "state", "redirect target"))
    plan = []
    for h, target in TARGETS.items():
        c = cols.get(h)
        if not c:
            print("  %-28s missing, nothing to do" % h)
            continue
        # refuse to retire a shelf that quietly came back to life
        alive = any(p["status"] == "ACTIVE" for p in c["products"]["nodes"])
        if alive:
            print("  %-28s HAS ACTIVE PRODUCTS, skipping" % h)
            continue
        if target not in live_targets:
            print("  %-28s target %s does not exist, skipping" % (h, target))
            continue
        path = "/collections/%s" % h
        plan.append((c, path, "/collections/%s" % target))
        print("  %-28s empty    %s -> /collections/%s%s"
              % (h, path, target, "  (redirect exists)" if path in existing else ""))

    if not apply:
        print("\ndry run. %d to retire. pass --apply." % len(plan))
        return

    print()
    for c, path, target in plan:
        if path not in existing:
            r = shopify.gql(MAKE, {"redirect": {"path": path, "target": target}})["urlRedirectCreate"]
            if r["userErrors"]:
                print("  redirect FAILED %-30s %s" % (path, r["userErrors"][0]["message"]))
                continue
        d = shopify.gql(DELETE, {"input": {"id": c["id"]}})["collectionDelete"]
        if d["userErrors"]:
            print("  delete FAILED   %-30s %s" % (c["handle"], d["userErrors"][0]["message"]))
        else:
            print("  retired %-28s -> %s" % (c["handle"], target))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    run(apply="--apply" in sys.argv)
