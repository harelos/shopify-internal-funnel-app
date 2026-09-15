# -*- coding: utf-8 -*-
"""Delete the legacy product-type collections, once nothing points at them.

Deleting is the only irreversible thing in this whole restructure, so it runs
last and it re-checks rather than trusting an earlier audit. Every menu in the
shop and every theme file that mentions a doomed handle has to come back clean
before a single delete is issued.

The k-beauty collections, the Seguno app collection and frontpage are not in
scope. Neither is anything the funnel touches.
"""
import json, os, re, subprocess, sys, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import shopify

SHOP, VER, TOKEN = os.environ["SHOP"], os.environ["VER"], os.environ["TOKEN"]

DOOMED = [
    "hair-care", "scalp-care", "skin-care", "hair-color", "hair-tools",
    "קולקציית-מוצרי-טיפוח-השיער-שלנו",
    "מוצרי-טיפוח-פנים",
    "קולקציית-מוצרי-טיפוח-הגוף-שלנו",
]

MENUS = """
{ menus(first: 30) { nodes { handle
    items { title url items { title url items { title url } } } } } }"""

FIND = """
query c($q: String!) { collections(first: 50, query: $q) {
  nodes { id handle title productsCount { count } } } }"""

DELETE = """
mutation d($input: CollectionDeleteInput!) {
  collectionDelete(input: $input) { deletedCollectionId userErrors { field message } }
}"""

# a handle only counts as referenced when it is used as a handle, not when it
# happens to be a substring: "novahair-coloring-kit" contains "hair-color"
PATTERNS = [r"collections\[['\"]%s['\"]\]", r"collections\.%s\b", r"/collections/%s(?![\w-])"]


def rest(path):
    p = subprocess.run(["curl", "-s", "-g",
                        "https://%s/admin/api/%s/%s" % (SHOP, VER, path),
                        "-H", "X-Shopify-Access-Token: " + TOKEN], capture_output=True)
    return json.loads(p.stdout.decode("utf-8", "replace"))


def menu_refs():
    hits = []
    for m in shopify.gql(MENUS)["menus"]["nodes"]:
        def walk(items):
            for it in items:
                u = urllib.parse.unquote(it.get("url") or "")
                for d in DOOMED:
                    if re.search(r"/collections/%s(?![\w-])" % re.escape(d), u):
                        hits.append((m["handle"], it["title"], d))
                walk(it.get("items") or [])
        walk(m["items"])
    return hits


def theme_refs(theme_id):
    keys = [a["key"] for a in rest("themes/%s/assets.json" % theme_id)["assets"]
            if a["key"].startswith(("sections/", "templates/", "snippets/", "layout/"))
            and a["key"].endswith((".liquid", ".json"))]
    hits = []
    for i, k in enumerate(keys):
        d = rest("themes/%s/assets.json?asset%%5Bkey%%5D=%s"
                 % (theme_id, urllib.parse.quote(k)))
        v = (d.get("asset") or {}).get("value") or ""
        if not v:
            continue
        vv = urllib.parse.unquote(v)
        for dh in DOOMED:
            for pat in PATTERNS:
                if re.search(pat % re.escape(dh), vv):
                    hits.append((k, dh))
                    break
        if i % 80 == 0:
            print("    ...scanned %d/%d" % (i, len(keys)), flush=True)
    return hits


def run(apply=False):
    theme_id = [t["id"] for t in rest("themes.json")["themes"]
                if t["role"] == "main"][0]

    print("checking menus")
    mrefs = menu_refs()
    for h, t, d in mrefs:
        print("  STILL LINKED  %-16s %-24s -> %s" % (h, t[:24], d))
    print("  %d menu references\n" % len(mrefs))

    print("checking theme %s" % theme_id)
    trefs = theme_refs(theme_id)
    for k, d in trefs:
        print("  STILL USED    %-46s -> %s" % (k, d))
    print("  %d theme references\n" % len(trefs))

    found = shopify.gql(FIND, {"q": " OR ".join("handle:%s" % d for d in DOOMED)})
    cols = [c for c in found["collections"]["nodes"] if c["handle"] in DOOMED]
    print("collections in scope: %d" % len(cols))
    for c in cols:
        print("  %-42s %3d products" % (c["handle"][:42], c["productsCount"]["count"]))

    if mrefs or trefs:
        print("\nrefusing to delete: something still points at these.")
        return
    if not apply:
        print("\nnothing points at them. dry run, pass --apply to delete.")
        return

    print()
    for c in cols:
        r = shopify.gql(DELETE, {"input": {"id": c["id"]}})["collectionDelete"]
        if r["userErrors"]:
            print("  FAILED  %-42s %s" % (c["handle"][:42], r["userErrors"][0]["message"]))
        else:
            print("  deleted %s" % c["handle"])


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    run(apply="--apply" in sys.argv)
