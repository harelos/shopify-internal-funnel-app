# -*- coding: utf-8 -*-
"""Create the eight mission collections in Shopify and publish them.

Additive and reversible. The seven collections that exist today are left exactly
as they are: nothing is deleted, no product is edited, no template is touched,
and the funnel is not involved. A product simply gains one more collection
membership, so if the missions turn out to be the wrong cut, deleting eight
collections puts the store back.

Re-running is safe. An existing mission collection is updated rather than
duplicated, which matters because the mapping will be adjusted a few times
before it is right.
"""
import json, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import shopify

PREFIX = "mission-"

PUBS = "{ publications(first: 20) { nodes { id name } } }"

BY_HANDLE = """
query c($q: String!) {
  collections(first: 5, query: $q) { nodes { id handle title } }
}"""

CREATE = """
mutation c($input: CollectionInput!) {
  collectionCreate(input: $input) {
    collection { id handle title }
    userErrors { field message }
  }
}"""

UPDATE = """
mutation u($input: CollectionInput!) {
  collectionUpdate(input: $input) {
    collection { id handle title }
    userErrors { field message }
  }
}"""

ADD = """
mutation a($id: ID!, $productIds: [ID!]!) {
  collectionAddProducts(id: $id, productIds: $productIds) {
    userErrors { field message }
  }
}"""

PUBLISH = """
mutation p($id: ID!, $input: [PublicationInput!]!) {
  publishablePublish(id: $id, input: $input) {
    userErrors { field message }
  }
}"""

PRODUCT_IDS = """
query p($q: String!) {
  products(first: 250, query: $q) { nodes { id handle } }
}"""


def online_store_publication():
    for n in shopify.gql(PUBS)["publications"]["nodes"]:
        if "online store" in (n["name"] or "").lower():
            return n["id"], n["name"]
    raise SystemExit("no Online Store publication on this shop")


def product_ids(handles):
    """Resolve handles to gids in as few calls as the query length allows."""
    got, todo = {}, list(handles)
    while todo:
        batch, todo = todo[:20], todo[20:]
        q = " OR ".join("handle:%s" % h for h in batch)
        for n in shopify.gql(PRODUCT_IDS, {"q": q})["products"]["nodes"]:
            got[n["handle"]] = n["id"]
    return got


def run(apply=False):
    missions = json.load(open(os.path.join(HERE, "missions.json"), encoding="utf-8"))
    pub_id, pub_name = online_store_publication()
    print("publishing to: %s\n" % pub_name)

    all_handles = sorted({i["handle"] for m in missions for i in m["items"]})
    ids = product_ids(all_handles)
    missing = [h for h in all_handles if h not in ids]
    if missing:
        print("could not resolve %d handles: %s" % (len(missing), missing[:5]))

    for m in missions:
        handle = PREFIX + m["key"]
        body = "<p>%s</p>" % m["line"]
        found = shopify.gql(BY_HANDLE, {"q": "handle:%s" % handle})["collections"]["nodes"]
        existing = next((c for c in found if c["handle"] == handle), None)

        if not apply:
            print("%-9s %-26s %2d products   %s"
                  % (m["key"], m["title"], m["count"],
                     "update" if existing else "create"))
            continue

        payload = {"title": m["title"], "handle": handle, "descriptionHtml": body,
                   "seo": {"title": "%s | %s" % (m["title"], m["brand"]),
                           "description": m["line"]}}
        if existing:
            payload["id"] = existing["id"]
            r = shopify.gql(UPDATE, {"input": payload})["collectionUpdate"]
        else:
            r = shopify.gql(CREATE, {"input": payload})["collectionCreate"]
        if r["userErrors"]:
            print("  FAILED %s: %s" % (handle, r["userErrors"][0]["message"]))
            continue
        cid = r["collection"]["id"]

        gids = [ids[i["handle"]] for i in m["items"] if i["handle"] in ids]
        if gids:
            e = shopify.gql(ADD, {"id": cid, "productIds": gids})["collectionAddProducts"]
            if e["userErrors"]:
                print("  add failed %s: %s" % (handle, e["userErrors"][0]["message"]))

        e = shopify.gql(PUBLISH, {"id": cid,
                                  "input": [{"publicationId": pub_id}]})["publishablePublish"]
        if e["userErrors"]:
            print("  publish failed %s: %s" % (handle, e["userErrors"][0]["message"]))

        print("  %-9s %-26s %2d products  /collections/%s"
              % (m["key"], m["title"], len(gids), handle))
        time.sleep(0.3)

    if not apply:
        print("\ndry run. pass --apply to write.")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    run(apply="--apply" in sys.argv)
