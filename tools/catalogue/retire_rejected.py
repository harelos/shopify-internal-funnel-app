# -*- coding: utf-8 -*-
"""Delete the drafts that should never have been created.

Eight products reached the catalogue because the reject list matched on titles
and the titles say nothing about what the carton says. Two of them carry skin
lightening claims, which is not a thing to leave sitting in an admin waiting for
somebody to publish it by accident.

Deleting rather than leaving them as drafts is deliberate. A draft is a thing
somebody can publish with one click, months later, without knowing why it was
held back. The reason lives in image_rejects.py and the product does not live
anywhere.

Safe to rerun: a product already gone is reported and skipped.
"""
import io, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import image_rejects
import shopify

DELETE = """
mutation d($input: ProductDeleteInput!) {
  productDelete(input: $input) { deletedProductId userErrors { field message } }
}
"""


def run():
    path = os.path.join(HERE, "published_glow.json")
    done = json.load(io.open(path, encoding="utf-8"))
    removed = []

    for idx in sorted(image_rejects.REJECTS):
        key = str(idx)
        rec = done.get(key)
        if not rec:
            print("  %02d already gone" % idx)
            continue
        d = shopify.gql(DELETE, {"input": {"id": rec["gid"]}})
        errs = d["productDelete"]["userErrors"]
        if errs:
            print("  %02d FAILED %s" % (idx, errs))
            continue
        removed.append((idx, rec["title"]))
        del done[key]
        json.dump(done, io.open(path, "w", encoding="utf-8"),
                  ensure_ascii=False, indent=1)
        print("  %02d deleted  %-30s %s" % (idx, rec["handle"], rec["title"]))

    print("\ndeleted %d, catalogue now %d products" % (len(removed), len(done)))
    for idx, title in removed:
        print("   %s" % image_rejects.reason(idx))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    run()
