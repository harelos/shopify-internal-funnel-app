# -*- coding: utf-8 -*-
"""Products rejected by looking at the picture, and pinned by index.

The first version of this file matched on product titles and matched nothing.
Every entry was written from the words printed on the carton, because that is
what you read when you are looking at the photograph, and CJ's listing title is
whatever the seller typed, which is something else entirely. A product whose
box says "Spot Whitening Cream" is titled "Hoygi Radiant Moisturizer". So all
seventeen rejects silently failed, the check printed "visual reject 0", and
that zero was read as "none present" when it meant "the matcher found nothing".
Eight products reached the catalogue that way, two of them carrying skin
lightening claims.

So the rejects are pinned to the source index now. An index cannot drift on a
rewording, and it cannot half-match. The trade is that the list only makes
sense against a specific selection, which is why the file names it.

Pinned against raw5/final50.json as selected on 2026-09-16.
"""

# index -> why it cannot be sold, in the words of what the photograph shows
REJECTS = {
    7:  "carton reads Tranexamic Acid, lighten freckles and brighten skin tone. "
        "Skin lightening is a claim this store does not make.",
    11: "carton reads 477 Skin Genesis Spot Whitening Cream. Same reason.",
    13: "carton reads Premium Retinol Moisturizer. Retinol is already the hero "
        "active of a product this store sells, and product 06 was dropped for "
        "the same reason before anything was created. Only the photograph says "
        "so; the listing title does not.",
    30: "box plus applicator vials branded DNA Anti-Aging Serum. The framing is "
        "medical and the shot is a box, not a product.",
    32: "photographed beside a syringe. The product is a topical serum and the "
        "picture sells an injectable.",
    33: "an ampoule carton with the vials arranged inside it, not a packshot.",
    34: "box plus dropper, and the carton leads on niacinamide, which is already "
        "the hero active of a product this store sells.",
    35: "an abstract render of ice and stone. Whatever it is, it is not the "
        "product.",
    36: "a How To Use instruction panel. One subject on a plain ground, so the "
        "automatic filter passed it, and still not product photography.",
}


def is_rejected(src_index):
    return int(src_index) in REJECTS


def reason(src_index):
    return REJECTS.get(int(src_index), "")


if __name__ == "__main__":
    import io, json, os, sys
    sys.stdout.reconfigure(encoding="utf-8")
    here = os.path.dirname(os.path.abspath(__file__))
    sel = json.load(io.open(os.path.join(here, "raw5", "final50.json"), encoding="utf-8"))
    print("%d rejected on sight\n" % len(REJECTS))
    for i, why in sorted(REJECTS.items()):
        print("  %02d  %s" % (i, (sel[i]["name"] or "")[:52]))
        print("      %s" % why)
