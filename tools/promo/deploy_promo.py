# -*- coding: utf-8 -*-
"""Put the September promotion live: calendar, discounts, page, theme files.

The design deliberately has no single point of failure at midnight.

  - The price change is done by Shopify automatic discounts, each created now
    with its own start and end timestamp. Shopify turns them on and off itself.
  - The page reads the calendar and picks today's row on every request, so it
    rotates without anyone editing it.
  - The scheduled agent therefore only has to check that reality matches the
    plan, and to build next month. If the agent never runs, September still
    works correctly.

Everything is scheduled in Asia/Jerusalem, which is UTC+3 through September.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import shopify
from promo_calendar import build, DAYS, WEEKS

IL = "+03:00"           # Israel Daylight Time, in force all of September 2026

SET_META = """
mutation setMeta($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id namespace key }
    userErrors { field message }
  }
}"""

DEF_META = """
mutation defMeta($definition: MetafieldDefinitionInput!) {
  metafieldDefinitionCreate(definition: $definition) {
    createdDefinition { id }
    userErrors { field message code }
  }
}"""

FIND_PRODUCT = """
query find($q: String!) { products(first: 1, query: $q) { nodes { id handle title } } }
"""

FIND_COLLECTION = """
query find($q: String!) { collections(first: 1, query: $q) { nodes { id handle title } } }
"""

CREATE_DISCOUNT = """
mutation disc($automaticBasicDiscount: DiscountAutomaticBasicInput!) {
  discountAutomaticBasicCreate(automaticBasicDiscount: $automaticBasicDiscount) {
    automaticDiscountNode { id }
    userErrors { field message code }
  }
}"""

LIST_DISCOUNTS = """
query list($q: String!) {
  automaticDiscountNodes(first: 100, query: $q) {
    nodes { id automaticDiscount { ... on DiscountAutomatic { __typename } } }
  }
}"""

CREATE_PAGE = """
mutation page($page: PageCreateInput!) {
  pageCreate(page: $page) {
    page { id handle title templateSuffix }
    userErrors { field message }
  }
}"""

FIND_PAGE = """
query find($q: String!) { pages(first: 1, query: $q) { nodes { id handle templateSuffix } } }
"""


def define_metafield():
    """Declare the calendar metafield so Liquid can read it as parsed JSON."""
    d = shopify.gql(DEF_META, {"definition": {
        "name": "Promo calendar",
        "namespace": "nova",
        "key": "promo_calendar",
        "description": "Rotating promotion schedule read by the deals page.",
        "type": "json",
        "ownerType": "SHOP",
        "access": {"storefront": "PUBLIC_READ"},
    }})["metafieldDefinitionCreate"]
    errs = [e for e in d["userErrors"] if e.get("code") != "TAKEN"]
    if errs:
        print("  metafield definition:", errs)
    else:
        print("  metafield definition ready")


def push_calendar():
    cal = build()
    d = shopify.gql(SET_META, {"metafields": [{
        "ownerId": shop_gid(),
        "namespace": "nova",
        "key": "promo_calendar",
        "type": "json",
        "value": json.dumps(cal, ensure_ascii=False),
    }]})["metafieldsSet"]
    if d["userErrors"]:
        raise RuntimeError(d["userErrors"])
    print("  calendar written: %d days, %d weekly offers"
          % (len(cal["days"]), len(cal["weeks"])))


_shop_gid = None


def shop_gid():
    global _shop_gid
    if _shop_gid is None:
        _shop_gid = shopify.gql("{ shop { id } }")["shop"]["id"]
    return _shop_gid


def product_gid(handle):
    n = shopify.gql(FIND_PRODUCT, {"q": "handle:%s" % handle})["products"]["nodes"]
    return n[0]["id"] if n else None


def collection_gid(handle):
    n = shopify.gql(FIND_COLLECTION, {"q": "handle:%s" % handle})["collections"]["nodes"]
    return n[0]["id"] if n else None


def existing_titles():
    got = shopify.gql(LIST_DISCOUNTS, {"q": "NovaDeal"})["automaticDiscountNodes"]["nodes"]
    return len(got)


def make_discounts():
    made, skipped = 0, []

    for date, handle, off, line, teaser in DAYS:
        if handle is None:
            continue
        gid = product_gid(handle)
        if not gid:
            skipped.append("%s %s (product not found)" % (date, handle))
            continue
        y, m, dd = date.split("-")
        nxt = "%s-%s-%02d" % (y, m, int(dd) + 1) if int(dd) < 30 else "2026-10-01"
        title = "NovaDeal %s %s" % (date, handle)
        d = shopify.gql(CREATE_DISCOUNT, {"automaticBasicDiscount": {
            "title": title,
            "startsAt": "%sT00:00:00%s" % (date, IL),
            "endsAt": "%sT00:00:00%s" % (nxt, IL),
            "customerGets": {
                "value": {"percentage": off / 100.0},
                "items": {"products": {"productsToAdd": [gid]}},
            },
            "combinesWith": {"orderDiscounts": False, "productDiscounts": False,
                             "shippingDiscounts": True},
        }})["discountAutomaticBasicCreate"]
        if d["userErrors"]:
            skipped.append("%s %s: %s" % (date, handle, d["userErrors"]))
            continue
        made += 1
        print("    %s  %2d%% off  %s" % (date, off, handle))

    for w in WEEKS:
        cg = collection_gid(w["collection"])
        if not cg:
            skipped.append("week %s (collection not found)" % w["from"])
            continue
        y, m, dd = w["to"].split("-")
        nxt = "%s-%s-%02d" % (y, m, int(dd) + 1) if int(dd) < 30 else "2026-10-01"
        title = "NovaDeal week %s %s" % (w["from"], w["collection"])
        d = shopify.gql(CREATE_DISCOUNT, {"automaticBasicDiscount": {
            "title": title,
            "startsAt": "%sT00:00:00%s" % (w["from"], IL),
            "endsAt": "%sT00:00:00%s" % (nxt, IL),
            "customerGets": {
                "value": {"percentage": w["percent"] / 100.0},
                "items": {"collections": {"add": [cg]}},
            },
            "combinesWith": {"orderDiscounts": False, "productDiscounts": False,
                             "shippingDiscounts": True},
        }})["discountAutomaticBasicCreate"]
        if d["userErrors"]:
            skipped.append("week %s: %s" % (w["from"], d["userErrors"]))
            continue
        made += 1
        print("    %s to %s  %d%% off collection %s"
              % (w["from"], w["to"], w["percent"], w["collection"]))

    print("  created %d scheduled discounts" % made)
    for s in skipped:
        print("  SKIPPED " + s)


def make_page():
    found = shopify.gql(FIND_PAGE, {"q": "handle:deals"})["pages"]["nodes"]
    if found:
        print("  page /pages/deals already exists (%s)" % found[0]["templateSuffix"])
        return
    d = shopify.gql(CREATE_PAGE, {"page": {
        "title": "שבועיים של טיפוח",
        "handle": "deals",
        "templateSuffix": "deals",
        "isPublished": False,          # stays hidden until the catalogue goes live
        "body": "",
    }})["pageCreate"]
    if d["userErrors"]:
        print("  page:", d["userErrors"])
        return
    print("  page created: /pages/%s on template '%s' (unpublished)"
          % (d["page"]["handle"], d["page"]["templateSuffix"]))


if __name__ == "__main__":
    print("metafield")
    define_metafield()
    push_calendar()
    print("discounts")
    make_discounts()
    print("page")
    make_page()
