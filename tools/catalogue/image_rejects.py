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
    3:  "carton reads Brightening and Freckle Removing Facial Cleanser. Only "
        "the generated frame revealed it, because it reproduced the carton "
        "faithfully and the CJ title says Facial Cleansing Gentle Moisturizer "
        "Care. Freckle removal is the same claim as 07 and 11.",
    7:  "carton reads Tranexamic Acid, lighten freckles and brighten skin tone. "
        "Skin lightening is a claim this store does not make.",
    8:  "the jar itself reads Reduce fat deposits, dark spots and scars. That "
        "is a slimming claim and a pigmentation claim printed on the product, "
        "so it cannot be cropped out the way a carton can. Surfaced only when "
        "the generated frame reproduced the label faithfully.",
    11: "carton reads 477 Skin Genesis Spot Whitening Cream. Same reason.",
    13: "carton reads Premium Retinol Moisturizer. Retinol is already the hero "
        "active of a product this store sells, and product 06 was dropped for "
        "the same reason before anything was created. Only the photograph says "
        "so; the listing title does not.",
    21: "the carton reads Glycolic Acid 7% Toning Solution, which is the same "
        "product as 18 and 22 from a different seller. Three sellers, one "
        "formula. CJ titles call them Exfoliating Toner, Toner and Toning "
        "Solution, so a word-overlap dedupe on titles cannot see it; the acid "
        "and the strength are only on the carton. 18 is kept because more "
        "merchants list it.",
    22: "also Glycolic Acid 7%. Same reason as 21.",
    27: "the bottle reads Whitening, Cleansing, Pore Minimizing under a Vitamin "
        "C+ Brightening and Anti-Aging line. Whitening is the same claim as 07, "
        "11 and 03, and it is printed on the bottle rather than the carton, so "
        "it cannot be cropped away.",
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
