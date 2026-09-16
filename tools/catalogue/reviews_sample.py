# -*- coding: utf-8 -*-
"""Demonstration reviews, written to show the design and marked as such.

Harel asked to see the review section full rather than empty, and said he would
delete the contents afterwards. So every row this creates sets `sample: true`,
which the theme section will not render unless its `show_sample` setting is
switched on, and that setting is off by default and belongs only in an
unpublished preview theme. When a sample row does render it carries a visible
orange label saying it is demonstration content and not a real customer. Two
independent switches therefore have to be thrown before any of this can appear
on a live page, and neither can be thrown by forgetting.

None of these rows sets `verified`. The verified badge means an order exists,
and no order exists for any of these.

`purge` removes every sample row in one call, so the cleanup Harel described is
one command rather than a hunt through the admin.

On variety, which was the specific note: real listings are lopsided. Most
reviews are four and five stars, a few are three, the three-star ones are the
longest and most specific, about a third carry no headline at all, and the
lengths are uneven. Uniformly enthusiastic five-star copy is the thing that
makes a review block read as fake at a glance, so the distribution here is
deliberately untidy.
"""
import io, json, os, random, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import shopify

CREATE = """
mutation c($metaobject: MetaobjectCreateInput!) {
  metaobjectCreate(metaobject: $metaobject) {
    metaobject { id handle }
    userErrors { field message code }
  }
}
"""

QUERY = """
query q($type: String!, $after: String) {
  metaobjects(type: $type, first: 100, after: $after) {
    nodes { id fields { key value } }
    pageInfo { hasNextPage endCursor }
  }
}
"""

DELETE = """
mutation d($id: ID!) {
  metaobjectDelete(id: $id) { deletedId userErrors { field message } }
}
"""

NAMES = [
    ("מיכל ב.", "תל אביב"), ("שירה ל.", "חיפה"), ("נועה ק.", "ראשון לציון"),
    ("אורית ש.", "מודיעין"), ("ליאת מ.", "פתח תקווה"), ("דנה א.", "רמת גן"),
    ("יעל ר.", "ירושלים"), ("הילה צ.", "באר שבע"), ("רננה פ.", "נתניה"),
    ("סיון ג.", "כפר סבא"), ("אפרת ד.", "רחובות"), ("טל ו.", "הרצליה"),
    ("מור נ.", "אשדוד"), ("עדי ח.", "גבעתיים"), ("רותם ס.", "חולון"),
    ("אילנית כ.", "רעננה"), ("שני ט.", "בת ים"), ("לירון א.", "קריית אונו"),
    ("גלית ה.", "זכרון יעקב"), ("מאיה ז.", "עפולה"),
]

# body pools per shelf. Written as things a person would actually say about the
# object in front of her, not as praise that would fit any product.
BODIES = {
    "ניקוי פנים": [
        (5, "סוף סוף בלי תחושת מתיחות", "חיפשתי הרבה זמן ניקוי שלא ישאיר את הפנים שלי מתוחות עד שאני מורחת קרם. זה הראשון שעבד. הקצף עדין, מספיק כמות קטנה."),
        (4, None, "עושה את העבודה ולא מייבש. הריח כמעט לא קיים וזה דווקא יתרון בעיני. מוריד את בסיס האיפור, אבל על מסקרה עמידה למים עדיין צריך משהו נוסף."),
        (3, "טוב, אבל הכמות מטעה", "המוצר עצמו בסדר גמור ואני משתמשת בו כל יום. רק שימו לב שהשפופרת קטנה יותר ממה שנראה בתמונה, ואצלי היא החזיקה קצת פחות מחודשיים בשימוש פעמיים ביום."),
        (5, None, "קניתי בהתחלה בספק והזמנתי עוד אחד אחרי שבועיים."),
    ],
    "טונר": [
        (5, "המרקם באמת השתנה", "לקח בערך שלושה שבועות עד שראיתי הבדל, אז אל תוותרו אחרי פעם אחת. אני משתמשת פעמיים בשבוע בערב כמו שכתוב ולא יותר."),
        (4, None, "נספג מהר ולא דביק, וזה מה שחיפשתי. הורדתי כוכב כי הפתח רחב מדי ואני שופכת יותר ממה שצריך על הפד."),
        (4, "התחלתי לאט וטוב שכך", "בפעם הראשונה עקצץ לי קצת אז ירדתי לפעם בשבוע ואחרי חודש עליתי. עכשיו העור מסתדר עם זה מצוין."),
        (3, "לא לעור שלי", "אין לי טענה למוצר, הוא פשוט חזק מדי בשבילי. אחרי שבועיים קיבלתי אדמומיות סביב האף והפסקתי. אחותי לקחה אותו ממני והיא מרוצה."),
        (5, None, "השני שאני קונה. פשוט עובד."),
    ],
    "קרם לחות": [
        (5, "העור מפסיק להתקלף בחורף", "אני משתמשת בו כשכבה אחרונה בערב והתעוררתי בפעם הראשונה מזה חודשים בלי אזורים יבשים סביב האף."),
        (4, None, "מרקם עשיר אבל נספג יפה. מתחת לאיפור אני מעדיפה משהו קליל יותר, אז אני משתמשת בו רק בערב."),
        (5, "מספיק כמות קטנה", "בהתחלה מרחתי יותר מדי והעור הבריק. עם כמות בגודל אפונה זה בדיוק מה שצריך, והצנצנת מחזיקה המון זמן."),
        (4, "טוב, בלי ניחוח", "זה מה שחיפשתי, קרם בלי ריח. העור שלי מגיב לניחוחות וכאן אין בעיה."),
    ],
    "אמפולה": [
        (5, "השתמשתי לפני חתונה", "עשיתי את כל השבוע לפני אירוע והעור נראה מלא יותר בתמונות. לא משהו שאני עושה כל חודש, אבל לאירוע זה שווה."),
        (4, None, "האמפולות קטנות ממה שדמיינתי, אבל כמות אחת באמת מספיקה לכל הפנים. הזכוכית נשברת בקלות אז תיזהרו."),
        (4, "מרגישה הבדל בלחות", "לא אגיד שראיתי שינוי דרמטי, אבל העור נעים יותר למגע והמייקאפ יושב אחרת."),
    ],
    "אסנס": [
        (4, None, "השלב הזה היה חסר לי בשגרה ולא ידעתי. נספג תוך שניות ואחריו הקרם עובד טוב יותר."),
        (5, "קטן ומחזיק הרבה", "הבקבוק נראה זעיר אבל שלוש טיפות זה כל מה שצריך. אני בשימוש חודש וחצי והוא עוד חצי מלא."),
        (3, "יפה אבל לא הכרחי", "מוצר נעים, פשוט לא בטוחה שהוא עושה משהו שהטונר והקרם לא עושים כבר. אולי אני צריכה עוד זמן איתו."),
    ],
    "פילינג": [
        (5, "הראשים השחורים באף באמת פחתו", "חודש של שימוש פעמיים בשבוע. לא נעלמו לגמרי, אבל ההבדל ברור כשמסתכלים מקרוב."),
        (4, None, "עובד. רק חשוב לא להגזים, ניסיתי כל יום בהתחלה והעור התעצבן. פעמיים בשבוע זה המקום הנכון."),
        (4, "שימו לב לקרם הגנה", "בבוקר אחרי אני מקפידה על הגנה ולא מוותרת. בלי זה העור שלי מתאדם בשמש."),
    ],
    "כלי עיסוי": [
        (5, "הבצקת בבוקר נעלמת", "חמש דקות בבוקר עם שמן ואני רואה הבדל בקו הלסת. לא קסם, אבל זה עובד ונעים."),
        (4, None, "האבן קרירה וזה החלק הכי נעים. חשוב להשתמש עם שמן, בלי זה זה מושך את העור ולא נעים בכלל."),
        (4, "הגיע שלם", "הייתי בטוחה שזה יגיע שבור אבל האריזה הייתה טובה. האבן כבדה ומרגישה איכותית."),
        (3, "יפה, אבל דורש התמדה", "השתמשתי שבועיים ואז שכחתי ממנו במגירה. זה עליי ולא על המוצר, אבל שווה לדעת שצריך לעשות מזה הרגל."),
    ],
    "קרם גוף": [
        (5, "נספג מהר מספיק כדי להתלבש", "זו הייתה הבעיה שלי עם כל קרם גוף. הזה נספג תוך דקה ואני לא נדבקת לבגדים."),
        (4, None, "עשיר ונעים. הצנצנת גדולה ומחזיקה הרבה זמן."),
    ],
    "פדים": [
        (5, "הכמות תמיד אותה כמות", "עם בקבוק הייתי שופכת יותר מדי. כאן כל פד זה בדיוק מה שצריך וזה גם יותר מהיר בערב."),
        (4, None, "70 פדים החזיקו לי בערך שלושה חודשים בשימוש פעמיים בשבוע. המלקחיים בקופסה זה פרט קטן ונחמד."),
    ],
    "מיסט": [
        (5, "מחזיקה אחד בתיק", "במשרד הממוזג זה מציל אותי אחרי הצהריים. אפשר גם מעל איפור ולא מקלקל."),
        (4, None, "הריסוס עדין ולא מציף את הפנים במים. נספג יפה."),
    ],
}


def pick_bodies(ptype, n, rnd):
    pool = BODIES.get(ptype) or BODIES["קרם לחות"]
    out = []
    for i in range(n):
        out.append(pool[(i + rnd.randrange(len(pool))) % len(pool)])
    return out


def run(per_product=(1, 3)):
    import copy_glow
    published = json.load(io.open(os.path.join(HERE, "published_glow.json"), encoding="utf-8"))
    by_src = {d["src"]: d for d in copy_glow.ALL}

    rnd = random.Random(20260916)
    names = NAMES[:]
    rnd.shuffle(names)
    made, ni = 0, 0

    for src, rec in published.items():
        it = by_src[int(src)]
        n = rnd.randint(*per_product)
        for rating, headline, body in pick_bodies(it["ptype"], n, rnd):
            name, note = names[ni % len(names)]
            ni += 1
            day = rnd.randint(1, 28)
            month = rnd.choice([7, 8, 9])
            fields = [
                {"key": "product", "value": rec["gid"]},
                {"key": "rating", "value": str(rating)},
                {"key": "body", "value": body},
                {"key": "author", "value": name},
                {"key": "author_note", "value": note},
                {"key": "review_date", "value": "2026-%02d-%02d" % (month, day)},
                {"key": "verified", "value": "false"},
                {"key": "sample", "value": "true"},
            ]
            if headline:
                fields.append({"key": "headline", "value": headline})
            d = shopify.gql(CREATE, {"metaobject": {
                "type": "nova_review", "fields": fields,
                "capabilities": {"publishable": {"status": "ACTIVE"}}}})
            r = d["metaobjectCreate"]
            if r["userErrors"]:
                print("FAILED %s: %s" % (it["handle"], r["userErrors"]))
                continue
            made += 1
    print("created %d demonstration reviews, every one flagged sample=true" % made)


def purge():
    """Delete every sample row. One command, because this content is temporary."""
    after, ids = None, []
    while True:
        d = shopify.gql(QUERY, {"type": "nova_review", "after": after})
        page = d["metaobjects"]
        for n in page["nodes"]:
            f = {x["key"]: x["value"] for x in n["fields"]}
            if f.get("sample") == "true":
                ids.append(n["id"])
        if not page["pageInfo"]["hasNextPage"]:
            break
        after = page["pageInfo"]["endCursor"]
    for i in ids:
        shopify.gql(DELETE, {"id": i})
    print("deleted %d sample reviews" % len(ids))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if "--purge" in sys.argv:
        purge()
    else:
        run()
