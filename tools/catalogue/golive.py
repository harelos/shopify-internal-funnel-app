# -*- coding: utf-8 -*-
"""Take the catalogue live.

Sets every imported product to ACTIVE and publishes it to the sales channels,
then publishes the promotion page. The September discounts were already created
with their own start and end timestamps, so the promotion becomes real the
moment the products are visible.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import shopify

PUBS = '{ publications(first: 10) { nodes { id name } } }'

ACTIVATE = """
mutation up($product: ProductUpdateInput!) {
  productUpdate(product: $product) {
    product { id handle status }
    userErrors { field message }
  }
}"""

PUBLISH = """
mutation pub($id: ID!, $input: [PublicationInput!]!) {
  publishablePublish(id: $id, input: $input) {
    userErrors { field message }
  }
}"""

FIND_PAGE = 'query f($q: String!) { pages(first: 1, query: $q) { nodes { id handle isPublished } } }'

PAGE_UP = """
mutation p($id: ID!, $page: PageUpdateInput!) {
  pageUpdate(id: $id, page: $page) {
    page { handle isPublished }
    userErrors { field message }
  }
}"""


def run():
    pubs = shopify.gql(PUBS)["publications"]["nodes"]
    print("sales channels:")
    for p in pubs:
        print("  %-28s %s" % (p["name"], p["id"]))
    targets = [{"publicationId": p["id"]} for p in pubs]

    pub = json.load(open(os.path.join(HERE, "published.json"), encoding="utf-8"))
    state_path = os.path.join(HERE, "live.json")
    done = json.load(open(state_path, encoding="utf-8")) if os.path.exists(state_path) else {}

    print("\nproducts:")
    for v in pub.values():
        h, gid = v["handle"], v["gid"]
        if done.get(h):
            continue
        a = shopify.gql(ACTIVATE, {"product": {"id": gid, "status": "ACTIVE"}})["productUpdate"]
        if a["userErrors"]:
            print("  FAIL %-34s %s" % (h, a["userErrors"]))
            continue
        p = shopify.gql(PUBLISH, {"id": gid, "input": targets})["publishablePublish"]
        if p["userErrors"]:
            print("  FAIL %-34s publish: %s" % (h, p["userErrors"]))
            continue
        done[h] = True
        json.dump(done, open(state_path, "w", encoding="utf-8"), ensure_ascii=False)
        print("  live %-34s" % h)
        sys.stdout.flush()

    print("\npromotion page:")
    pg = shopify.gql(FIND_PAGE, {"q": "handle:deals"})["pages"]["nodes"]
    if not pg:
        print("  /pages/deals not found")
    else:
        r = shopify.gql(PAGE_UP, {"id": pg[0]["id"], "page": {"isPublished": True}})["pageUpdate"]
        if r["userErrors"]:
            print("  FAIL %s" % r["userErrors"])
        else:
            print("  live /pages/%s" % r["page"]["handle"])

    print("\n%d of %d products live" % (len(done), len(pub)))


if __name__ == "__main__":
    run()
