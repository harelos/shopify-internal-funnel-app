# -*- coding: utf-8 -*-
"""Replace every product photo with the rebuilt single-product tile.

The new tile shows one object, cut out, at a scale set by the product's real
declared volume, so a 500ml shampoo is visibly bigger than a 30ml dropper across
the whole grid. The old tile often showed the bottle beside its carton.

Upload first, then delete the old media, so a failure never leaves a product
with no image at all.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import shopify

MEDIA_Q = """
query m($id: ID!) {
  product(id: $id) { handle media(first: 20) { nodes { id ... on MediaImage { id } } } }
}"""

DEL = """
mutation d($productId: ID!, $mediaIds: [ID!]!) {
  productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
    deletedMediaIds
    mediaUserErrors { field message }
  }
}"""

ADD = """
mutation a($productId: ID!, $media: [CreateMediaInput!]!) {
  productCreateMedia(productId: $productId, media: $media) {
    media { ... on MediaImage { id } }
    mediaUserErrors { field message }
  }
}"""

ALT = {
    "novahair": "בקבוק המוצר של NovaHair על רקע נקי",
    "novaglow": "אריזת המוצר של NovaGlow על רקע נקי",
}


def run():
    rows = json.load(open(os.path.join(HERE, "tiles2.json"), encoding="utf-8"))
    state_path = os.path.join(HERE, "images_swapped.json")
    done = json.load(open(state_path, encoding="utf-8")) if os.path.exists(state_path) else {}

    for r in rows:
        h, gid, tile = r["handle"], r["gid"], r["tile2"]
        if done.get(h):
            continue
        if not os.path.exists(tile):
            print("  SKIP %-34s tile missing on disk" % h)
            continue

        before = shopify.gql(MEDIA_Q, {"id": gid})["product"]["media"]["nodes"]
        old_ids = [m["id"] for m in before]

        alt = ALT["novaglow" if h.startswith("novaglow") else "novahair"]
        try:
            res = shopify.upload_image(tile, "%s.jpg" % h)
            a = shopify.gql(ADD, {"productId": gid, "media": [{
                "originalSource": res, "mediaContentType": "IMAGE", "alt": alt}]})
            errs = a["productCreateMedia"]["mediaUserErrors"]
            if errs:
                print("  FAIL %-34s add: %s" % (h, errs))
                continue
        except Exception as e:
            print("  FAIL %-34s %s" % (h, str(e)[:120]))
            continue

        # only now is it safe to remove the old one
        if old_ids:
            d = shopify.gql(DEL, {"productId": gid, "mediaIds": old_ids})
            errs = d["productDeleteMedia"]["mediaUserErrors"]
            if errs:
                print("  WARN %-34s old media kept: %s" % (h, errs))

        done[h] = True
        json.dump(done, open(state_path, "w", encoding="utf-8"), ensure_ascii=False)
        print("  ok   %-34s replaced (%d old removed)" % (h, len(old_ids)))
        sys.stdout.flush()

    print("\nswapped %d of %d" % (len(done), len(rows)))


if __name__ == "__main__":
    run()
