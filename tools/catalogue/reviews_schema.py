# -*- coding: utf-8 -*-
"""The review system's storage: one metaobject definition, queryable from Liquid.

Harel's requirement was specific and it is the part that decides the design: a
product page shows only that product's reviews, and a reviews page shows all of
them, from one store of data. That rules out the usual shortcut of a rich-text
metafield per product, because text on a product cannot be aggregated, sorted
or counted across the catalogue.

So each review is its own metaobject with a product reference on it. Liquid can
then read `shop.metaobjects.nova_review.values` once and filter it by the
current product on a PDP, or render the whole set on a page, without a second
source of truth and without an app.

Fields are chosen for what the section actually renders. `verified` exists so
that a review tied to a real order can be marked as such and a review that is
not tied to one cannot borrow that badge by accident: the badge is driven by
this field alone, never by the presence of an order number in the body text.
"""
import io, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import shopify

DEFINITION = """
mutation d($definition: MetaobjectDefinitionCreateInput!) {
  metaobjectDefinitionCreate(definition: $definition) {
    metaobjectDefinition { id type name }
    userErrors { field message code }
  }
}
"""

FIELDS = [
    dict(key="product", name="מוצר", type="product_reference",
         required=True,
         description="The product this review belongs to. The PDP filters on it."),
    dict(key="rating", name="דירוג", type="number_integer", required=True,
         validations=[{"name": "min", "value": "1"}, {"name": "max", "value": "5"}],
         description="1 to 5. The aggregate and the distribution bars read this."),
    dict(key="headline", name="כותרת", type="single_line_text_field",
         description="Short line shown in bold above the body."),
    dict(key="body", name="תוכן", type="multi_line_text_field", required=True),
    dict(key="author", name="שם", type="single_line_text_field", required=True),
    dict(key="author_note", name="תיאור", type="single_line_text_field",
         description="Free text under the name, for example a city or an age band."),
    dict(key="review_date", name="תאריך", type="date", required=True),
    dict(key="verified", name="רכישה מאומתת", type="boolean",
         description="True only when this review is tied to a real order. The "
                     "badge in the theme is driven by this field and by nothing "
                     "else, so it cannot be implied by wording in the body."),
    dict(key="sample", name="תוכן הדגמה", type="boolean",
         description="True marks a row as demonstration content that was never a "
                     "real customer. The theme refuses to render a row with this "
                     "set unless it is running in a preview theme, so sample data "
                     "cannot reach a live storefront by being forgotten."),
]


def build_field(f):
    out = {"key": f["key"], "name": f["name"], "type": f["type"]}
    if f.get("required"):
        out["required"] = True
    if f.get("validations"):
        out["validations"] = f["validations"]
    if f.get("description"):
        out["description"] = f["description"]
    return out


def run():
    definition = {
        # "product_review" is reserved by Shopify for its own review system
        "type": "nova_review",
        "name": "ביקורת מוצר",
        "displayNameKey": "author",
        "fieldDefinitions": [build_field(f) for f in FIELDS],
        "access": {"storefront": "PUBLIC_READ"},
        "capabilities": {"publishable": {"enabled": True}},
    }
    d = shopify.gql(DEFINITION, {"definition": definition})
    r = d["metaobjectDefinitionCreate"]
    if r["userErrors"]:
        codes = [e.get("code") for e in r["userErrors"]]
        if "TAKEN" in codes:
            print("definition already exists, nothing to do")
            return
        raise RuntimeError(r["userErrors"])
    print("created %s" % r["metaobjectDefinition"]["id"])
    for f in FIELDS:
        print("   %-12s %s" % (f["key"], f["type"]))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    run()
