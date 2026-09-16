# -*- coding: utf-8 -*-
"""Give every product its own list of reviews, because Liquid caps the global one.

The first version of this section read `shop.metaobjects.nova_review.values` and
filtered it by the current product. That renders correctly and it does not
scale: Liquid returns at most 50 entries from that collection, so with 90
reviews in the store the aggregate showed 4.3 out of 50 reviews and silently
ignored the other 40. Nothing errors. The number is just quietly wrong, which is
the worst way for a rating to be wrong.

So the reference is inverted. Each product carries a metafield holding the list
of its own reviews, and the PDP reads that list instead of scanning the store.
A product with 12 reviews now reads 12 entries and the 50 cap never applies to
it, because the cap is per collection and each product's collection is its own.

The store-wide reviews page still reads the global collection and is still
capped at 50. That is left as it is, and the page says so in its own copy,
because the honest fix for an unbounded store-wide list is a paginated fetch
rather than a Liquid loop, and that is a larger piece of work than this one.
"""
import io, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import shopify

DEFINE = """
mutation d($definition: MetafieldDefinitionInput!) {
  metafieldDefinitionCreate(definition: $definition) {
    createdDefinition { id key namespace }
    userErrors { field message code }
  }
}
"""

QUERY = """
query q($after: String) {
  metaobjects(type: "nova_review", first: 100, after: $after) {
    nodes { id fields { key value } }
    pageInfo { hasNextPage endCursor }
  }
}
"""

SET = """
mutation s($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id }
    userErrors { field message }
  }
}
"""


def definition_id():
    d = shopify.gql('{ metaobjectDefinitionByType(type: "nova_review") { id } }', {})
    return d["metaobjectDefinitionByType"]["id"]


def define():
    DEF_ID = definition_id()
    d = shopify.gql(DEFINE, {"definition": {
        "name": "ביקורות",
        "namespace": "nova",
        "key": "reviews",
        "description": "The reviews written about this product. The PDP reads "
                       "this instead of scanning every review in the store, "
                       "because Liquid returns at most 50 of those.",
        "type": "list.metaobject_reference",
        "ownerType": "PRODUCT",
        # the validation wants the definition's gid, not its type string
        "validations": [{"name": "metaobject_definition_id", "value": DEF_ID}],
        "access": {"storefront": "PUBLIC_READ"},
    }})
    r = d["metafieldDefinitionCreate"]
    if r["userErrors"]:
        if any(e.get("code") == "TAKEN" for e in r["userErrors"]):
            print("metafield definition already exists")
            return
        raise RuntimeError(r["userErrors"])
    print("created metafield definition nova.reviews")


def gather():
    """product gid -> [review gid, ...], walking every page of reviews."""
    by_product, after = {}, None
    total = 0
    while True:
        d = shopify.gql(QUERY, {"after": after})
        page = d["metaobjects"]
        for n in page["nodes"]:
            f = {x["key"]: x["value"] for x in n["fields"]}
            pid = f.get("product")
            if not pid:
                continue
            by_product.setdefault(pid, []).append(n["id"])
            total += 1
        if not page["pageInfo"]["hasNextPage"]:
            break
        after = page["pageInfo"]["endCursor"]
    print("walked %d reviews across %d products" % (total, len(by_product)))
    return by_product


def run():
    define()
    by_product = gather()
    payload = [{
        "ownerId": pid,
        "namespace": "nova",
        "key": "reviews",
        "type": "list.metaobject_reference",
        "value": json.dumps(ids),
    } for pid, ids in by_product.items()]

    for i in range(0, len(payload), 25):
        chunk = payload[i:i + 25]
        d = shopify.gql(SET, {"metafields": chunk})
        errs = d["metafieldsSet"]["userErrors"]
        print("  set %2d products %s" % (len(chunk), errs if errs else "OK"))
    print("\nlinked reviews onto %d products" % len(payload))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    run()
