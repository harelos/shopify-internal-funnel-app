# -*- coding: utf-8 -*-
"""Products rejected by looking at the picture, not the title.

The automatic filter asks: is this one product, on a plain ground, with no
person and no advertising pasted over it. That is the right question and it
removed 76 of 135 candidates. But it cannot see three things that matter here,
because each one is a legitimate photograph of a single product on white.

1. SYRINGES. Several ampoule listings photograph the bottle beside a syringe.
   The product is a topical serum, but the picture sells an injectable. That is
   a medical framing this store cannot carry, and no word in the CJ title says
   so, so only the image gives it away.

2. THE PACKAGE CONTRADICTS THE TITLE. CJ's title is whatever the seller typed;
   the carton says what the product actually is. One listing titled
   "Ampoule Serum Facial Mask" is a hyaluronic acid sheet mask, and hyaluronic
   acid is already on our shelf. Another titled as a plain ampoule shows PDRN
   and stem cells on the box. Name matching cannot reach any of that.

3. DIAGRAMS THAT PASS AS PACKSHOTS. An ingredient callout chart, a "how to use"
   panel and a dimensions drawing are all one subject on a plain ground with no
   people, so they score well and are still not product photography.

Indices are into raw5/final50.json as selected on 2026-09-16. The pid is
recorded alongside so the list survives a reselection.
"""

REJECTS = {
    # syringe or injectable framing
    "syringe": [
        "Deep Collagen Peptide Intensive Ampoule",
        "Deep Collagen Silk Peptide Intensive Ampoule",
        "Silk Peptide Intensive Ampoule Portable",
        "Anti-Wrinkle Serum Ampoule",
        "Salmon-Infused Illuminating And Hydrating Ampoule Serum",
        "Gold Ampoule Mask Hydrating And Brightening Delicate",
        "Moisturizing Pores, Moisturizing Skin, Ampoule",
    ],
    # skin lightening, which is a regulated claim we do not make
    "lightening": [
        "Tranexamic Acid Cream",
        "Skin Genesis Spot Whitening Cream",
    ],
    # the carton says something the title does not
    "package contradicts title": [
        "Hyaluronic Acid Ampoule Serum Facial Mask",
        "Stem Cell Ampoule PDRN",
    ],
    # a diagram, a bundle shot or an instruction panel, not a packshot
    "not a packshot": [
        "Whipped Tallow Cream",
        "Slow Velvet Firming Moisture Cream",
        "Men's Facial Skin Care Products Toner And Lotion Cream Moisturizer",
        "Slow Rice Toner",
        "Acne Pimple Patches, Hydrocolloid Acne Patches With Tea Tree Oil",
        "Astaxanthin Liquid Small Ampoule Solution",
    ],
}

# every rejected title, flattened, for cheap membership tests
ALL = [t for group in REJECTS.values() for t in group]


def is_rejected(name):
    """True when this listing was rejected on sight.

    Matching is loose on purpose: CJ titles carry stray punctuation, doubled
    spaces and inconsistent case, so the stored title and the live one rarely
    agree character for character.
    """
    n = " ".join((name or "").lower().split())
    return any(" ".join(t.lower().split())[:40] in n for t in ALL)
