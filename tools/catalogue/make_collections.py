# -*- coding: utf-8 -*-
"""Group the new catalogue into collections.

These are smart collections driven by product type, so a product created later
files itself without anyone touching the collection. Each one carries its own
Hebrew SEO title and description, because a collection page is usually what
ranks for a category search rather than any single product page.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import shopify

COLLECTIONS = [
    dict(handle="hair-color",
         title="צביעה וכיסוי שורשים",
         types=["צבע שיער"],
         seo_title="צביעת שיער בבית וכיסוי שורשים לבנים | NovaHair",
         seo_desc="שמפו צבע, קרם צבע עם מסרק וספריי כיסוי שורשים, "
                  "לטיפול בשורש בין תור לתור במספרה.",
         body="<p>הכול לטיפול בשורש בין תור לתור במספרה. שמפו צבע שעובד בזמן החפיפה, "
              "קרם עם מסרק מובנה לקו השורש, וספריי לכיסוי מיידי ביום שאין בו זמן.</p>"),

    dict(handle="hair-care",
         title="טיפוח שיער",
         types=["טיפוח שיער", "עיצוב שיער"],
         seo_title="טיפוח שיער צבוע | שמפו, מסכות ושמנים | NovaHair",
         seo_desc="שמפו, מסכות, שמנים וסרומים לשיער שעבר צביעה והחלקה. "
                  "מוצרים לשגרה שבועית ולא לטיפול חד פעמי.",
         body="<p>שיער צבוע מאבד לחות מהר יותר משיער טבעי. האוסף הזה בנוי סביב השגרה "
              "שמחזיקה את הצבע ואת המרקם בין צביעה לצביעה.</p>"),

    dict(handle="scalp-care",
         title="טיפוח קרקפת",
         types=["טיפוח קרקפת"],
         seo_title="טיפוח קרקפת | סרומים, שמנים וספריי לשורש | NovaHair",
         seo_desc="סרומים, שמנים ואמפולות לטיפול בקרקפת, לשיער דליל "
                  "ולקרקפת יבשה או מגרדת.",
         body="<p>שיער מתחיל בקרקפת. כאן נמצאים הסרומים, השמנים והאמפולות "
              "שמטפלים בשורש עצמו, ולא באורך.</p>"),

    dict(handle="hair-tools",
         title="אביזרי שיער",
         types=["אביזרי שיער"],
         seo_title="אביזרי שיער | מברשות, מסרקים וערכות צביעה | NovaHair",
         seo_desc="מברשות, מסרקים, ערכות צביעה ואביזרי עיצוב ללא חום. "
                  "הכלים שהופכים טיפוח ביתי לפשוט יותר.",
         body="<p>הכלים שעושים את ההבדל בין טיפוח ביתי מסודר לבלגן בכיור. "
              "בלי אביזרים חשמליים, כי תקע אמריקאי ומתח 110 וולט לא עוזרים לאף אחד בארץ.</p>"),

    dict(handle="skin-care",
         title="טיפוח פנים וגוף",
         types=["טיפוח פנים", "הגנה מהשמש", "טיפוח גוף"],
         seo_title="טיפוח פנים וגוף | סרומים, קרמי הגנה ופילינג | NovaGlow",
         seo_desc="סרומים, קרמי הגנה מהשמש ופילינג גוף. מדף קצר ומדויק "
                  "ולא שגרה של עשרה שלבים.",
         body="<p>מדף קצר בכוונה. כמה מוצרים שכל אחד מהם עושה דבר אחד ברור, "
              "במקום שגרה של עשרה שלבים שאף אחת לא מחזיקה לאורך זמן.</p>"),
]

CREATE = """
mutation col($input: CollectionInput!) {
  collectionCreate(input: $input) {
    collection { id handle title productsCount { count } }
    userErrors { field message }
  }
}"""

LOOKUP = """
query find($q: String!) {
  collections(first: 5, query: $q) { nodes { id handle } }
}"""


def run():
    out = {}
    for c in COLLECTIONS:
        found = shopify.gql(LOOKUP, {"q": "handle:%s" % c["handle"]})["collections"]["nodes"]
        if found:
            print("exists  %-14s %s" % (c["handle"], c["title"]))
            out[c["handle"]] = found[0]["id"]
            continue

        rules = [{"column": "TYPE", "relation": "EQUALS", "condition": t} for t in c["types"]]
        payload = {
            "handle": c["handle"],
            "title": c["title"],
            "descriptionHtml": c["body"],
            "seo": {"title": c["seo_title"], "description": c["seo_desc"]},
            "ruleSet": {"appliedDisjunctively": True, "rules": rules},
            "sortOrder": "BEST_SELLING",
        }
        d = shopify.gql(CREATE, {"input": payload})["collectionCreate"]
        if d["userErrors"]:
            print("FAILED  %-14s %s" % (c["handle"], d["userErrors"]))
            continue
        col = d["collection"]
        out[c["handle"]] = col["id"]
        print("created %-14s %-22s (%d products matched)"
              % (col["handle"], col["title"], col["productsCount"]["count"]))

    json.dump(out, open(os.path.join(HERE, "collections.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    return out


if __name__ == "__main__":
    run()
