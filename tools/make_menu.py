# -*- coding: utf-8 -*-
"""Rebuild the main menu around the two brands and their missions.

Before: דף הבית, טיפוח פנים, טיפוח השיער, טיפוח הגוף. Three of those point at
the legacy product-type collections, and one of them (טיפוח הגוף) points at a
collection that no longer has products in it.

After: דף הבית, NovaHair, NovaGlow, מבצעים. The two brands carry the missions as
children, which is the structure Briogeo and ELEVEN use and none of the Israeli
brands in the research do.

The current menu is written to menu-backup.json before anything changes, and
--restore puts it back.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import shopify

BACKUP = os.path.join(HERE, "menu-backup.json")

READ = """
{ menus(first: 10, query: "handle:main-menu OR handle:footer-shop") { nodes { id handle title
    items { id title type url resourceId tags
      items { id title type url resourceId tags } } } } }"""

COLLECTIONS = """
{ collections(first: 40, query: "handle:mission-*") { nodes { id handle title } } }"""

UPDATE = """
mutation m($id: ID!, $title: String!, $handle: String!, $items: [MenuItemUpdateInput!]!) {
  menuUpdate(id: $id, title: $title, handle: $handle, items: $items) {
    menu { id handle items { title items { title } } }
    userErrors { field message }
  }
}"""

# brand -> the missions under it, in the order a customer meets them
TREE = [
    ("NovaHair", ["mission-roots", "mission-scalp", "mission-repair", "mission-tools"]),
    ("NovaGlow", ["mission-night", "mission-serums", "mission-protect", "mission-body"]),
]


def current(handle="main-menu"):
    for m in shopify.gql(READ)["menus"]["nodes"]:
        if m["handle"] == handle:
            return m
    raise SystemExit("menu not found: %s" % handle)


def save_backup(menu, name="main"):
    path = BACKUP if name == "main" else BACKUP.replace(".json", "-%s.json" % name)
    if os.path.exists(path):
        print("backup already exists, leaving it alone: %s" % path)
        return
    json.dump(menu, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("backed up the live menu to %s" % path)


def to_input(items):
    """Turn the menu we read back into the shape menuUpdate expects."""
    out = []
    for it in items:
        d = {"title": it["title"], "type": it["type"]}
        if it.get("resourceId"):
            d["resourceId"] = it["resourceId"]
        elif it.get("url"):
            d["url"] = it["url"]
        if it.get("items"):
            d["items"] = to_input(it["items"])
        out.append(d)
    return out


def build(cols):
    by_handle = {c["handle"]: c for c in cols}
    items = [{"title": "דף הבית", "type": "FRONTPAGE"}]

    for brand, handles in TREE:
        kids = [{"title": by_handle[h]["title"], "type": "COLLECTION",
                 "resourceId": by_handle[h]["id"]}
                for h in handles if h in by_handle]
        if not kids:
            continue
        # the parent opens the first mission rather than a dead landing page
        items.append({"title": brand, "type": "COLLECTION",
                      "resourceId": by_handle[handles[0]]["id"],
                      "items": kids})

    items.append({"title": "מבצעים", "type": "HTTP", "url": "/pages/deals"})
    return items


FOOTER = ["mission-roots", "mission-scalp", "mission-repair", "mission-tools",
          "mission-night", "mission-serums"]


def build_footer(cols):
    """The footer shop column pointed at three legacy collections, one of which
    had two products left in it."""
    by_handle = {c["handle"]: c for c in cols}
    return [{"title": by_handle[h]["title"], "type": "COLLECTION",
             "resourceId": by_handle[h]["id"]}
            for h in FOOTER if h in by_handle]


def run(apply=False, restore=False):
    menu = current()
    save_backup(menu)
    save_backup(current("footer-shop"), "footer-shop")

    if restore:
        old = json.load(open(BACKUP, encoding="utf-8"))
        r = shopify.gql(UPDATE, {"id": menu["id"], "title": old["title"],
                                 "handle": old["handle"],
                                 "items": to_input(old["items"])})["menuUpdate"]
        print("restored" if not r["userErrors"] else r["userErrors"])
        return

    cols = shopify.gql(COLLECTIONS)["collections"]["nodes"]
    items = build(cols)
    foot = current("footer-shop")
    foot_items = build_footer(cols)

    print("\nproposed footer shop column:")
    for it in foot_items:
        print("  %s" % it["title"])
    if apply:
        r = shopify.gql(UPDATE, {"id": foot["id"], "title": foot["title"],
                                 "handle": foot["handle"],
                                 "items": foot_items})["menuUpdate"]
        print("  -> %s" % ("updated" if not r["userErrors"] else r["userErrors"]))

    print("\nproposed main menu:")
    for it in items:
        print("  %s" % it["title"])
        for k in it.get("items", []):
            print("      %s" % k["title"])

    if not apply:
        print("\ndry run. pass --apply to write, --restore to undo.")
        return

    r = shopify.gql(UPDATE, {"id": menu["id"], "title": menu["title"],
                             "handle": menu["handle"], "items": items})["menuUpdate"]
    if r["userErrors"]:
        print("\nFAILED: %s" % r["userErrors"])
    else:
        print("\nlive menu now:")
        for it in r["menu"]["items"]:
            print("  %-12s %s" % (it["title"], [k["title"] for k in it["items"]]))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    run(apply="--apply" in sys.argv, restore="--restore" in sys.argv)
