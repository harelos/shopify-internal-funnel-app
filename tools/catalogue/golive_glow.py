# -*- coding: utf-8 -*-
"""Publish only the products whose photograph is fit to be seen.

"Publish what's ready" is a judgement about images, because the copy, the
pricing and the subscriptions are finished for all of them. A product is ready
when its photograph is the product and nothing else: no carton, no box behind
the bottle, no syringe, no ingredient chart, and no claim printed on the pack
that the store does not make.

Everything else stays a draft until its generated frame exists. That is not a
quality compromise deferred, it is the same standard applied later.

READY is listed by index and by reason rather than computed, because the test
is what a photograph shows and there is no filter for that. The eight indexes
here were each looked at.
"""
import io, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import copy_glow
import shopify

# A product is ready when its photograph is the product and nothing else.
#
# Any product with a generated house frame qualifies by construction: the frame
# is made from a prompt that forbids the carton, and every batch was checked
# against its reference before being filed. The few below are supplier shots
# that were already clean when looked at.
#
# 37 is deliberately excluded. Its photograph reads as polished stone while its
# own specification sheet says resin, and the copy says resin because that is
# what arrives. A stone photograph against a resin description invites exactly
# one support ticket per order.
import os

APPROVED_SUPPLIER_SHOTS = {
    24: "supplier shot is already a single bottle on a clean ground",
    38: "stone alone",
    39: "the three amethyst pieces, nothing else",
    40: "stone alone",
    41: "roller and stone, nothing else",
}
HELD = {37: "photo reads as stone, spec sheet and copy say resin"}


def ready(src_index):
    if src_index in HELD:
        return None
    gen = os.path.join(HERE, "gen", "out", "%02d_0_hero.png" % src_index)
    if os.path.exists(gen):
        return "generated house frame"
    return APPROVED_SUPPLIER_SHOTS.get(src_index)


ACTIVATE = """
mutation up($product: ProductUpdateInput!) {
  productUpdate(product: $product) {
    product { id handle status }
    userErrors { field message }
  }
}
"""

PUBS = "{ publications(first: 10) { nodes { id name } } }"

PUBLISH = """
mutation p($id: ID!, $input: [PublicationInput!]!) {
  publishablePublish(id: $id, input: $input) {
    userErrors { field message }
  }
}
"""


def run():
    done = json.load(io.open(os.path.join(HERE, "published_glow.json"), encoding="utf-8"))
    by_src = {d["src"]: d for d in copy_glow.ALL}

    pubs = shopify.gql(PUBS, {})["publications"]["nodes"]
    online = [p for p in pubs if "Online Store" in p["name"]]
    if not online:
        sys.exit("no Online Store publication found")
    targets = [{"publicationId": p["id"]} for p in online]
    print("publishing to: %s\n" % ", ".join(p["name"] for p in online))

    live, held = [], []
    for src, rec in sorted(done.items(), key=lambda kv: int(kv[0])):
        idx = int(src)
        why = ready(idx)
        if not why:
            held.append((idx, by_src[idx]["title"]))
            continue
        d = shopify.gql(ACTIVATE, {"product": {"id": rec["gid"], "status": "ACTIVE"}})
        errs = d["productUpdate"]["userErrors"]
        if errs:
            print("  FAILED %-30s %s" % (rec["handle"], errs))
            continue
        d = shopify.gql(PUBLISH, {"id": rec["gid"], "input": targets})
        errs = d["publishablePublish"]["userErrors"]
        if errs:
            print("  FAILED publish %-24s %s" % (rec["handle"], errs))
            continue
        live.append((idx, rec["handle"], by_src[idx]["title"]))
        print("  live  %-34s %-26s %s" % (rec["handle"], by_src[idx]["title"], why))
        sys.stdout.flush()

    print("\n%d live, %d still drafts waiting on a photograph" % (len(live), len(held)))
    for idx, title in held:
        print("   %02d %s" % (idx, title))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    run()
