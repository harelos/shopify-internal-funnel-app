# -*- coding: utf-8 -*-
"""A send every day to the end of September, each to its own audience.

Thirteen sends across the fifteen remaining days. Only Yom Kippur is dark.
The two Saturdays go out motzei Shabbat at 20:30, which is when an Israeli list
is actually read.

Every audience is cut from two years of order history and sized against the
live customer base. They are deliberately small: the point of a daily send is
that each one is relevant to the few hundred people who get it, not that the
whole list hears from us fifteen times.

Every promotional audience excludes anyone whose parcel is probably still in
the air. The store records no delivery confirmations at all, so days since the
order is the only honest proxy and CJ to Israel runs 8 to 20 days.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import shopify

COUNT = 'query c($query: String!) { customerSegmentMembers(first: 1, query: $query) { totalCount } }'

SUB = "email_subscription_status = 'SUBSCRIBED'"
ARRIVED = "(number_of_orders = 0 OR last_order_date < -14d)"
DORMANT = "last_order_date < -365d"

P = {
    "elastic":  9671746683175,   # מסיכת קולגן לילה, 1418 orders
    "hyaluron": 9695478677799,   # סרום היאלורוני 4 ב-1, 1021
    "amla":     9566713905447,   # שמפו אמלה, 1008
    "castor":   9608345944359,   # שמן קיק, 420
}


def has(k):
    return "products_purchased MATCHES (id = %d)" % P[k]


def q(*clauses):
    return " AND ".join([SUB, ARRIVED] + list(clauses))


# date, weekday, send time, segment, query, promo day it rides, the angle
PLAN = [
    ("2026-09-16", "רביעי", "09:00", "ספט · קוני אמלה בלבד",
     q(has("amla"), "NOT " + has("castor")), "יום הצבע",
     "קנו שמפו לשיער ומעולם לא קנו שום דבר אחר לשיער."),

    ("2026-09-17", "חמישי", "09:00", "ספט · קוני שמן קיק",
     q(has("castor")), "שמן ארגן לשיער",
     "כבר קנו שמן לשיער. יום של שמן הוא ההצעה שלהן."),

    ("2026-09-18", "שישי", "08:30", "ספט · לקוחות חוזרים",
     q("number_of_orders > 1"), "שגרת החפיפה המלאה",
     "מי שקנתה יותר מפעם אחת קונה שגרה ולא מוצר. יום החבילה שלה."),

    ("2026-09-19", "מוצ״ש", "20:30", "ספט · רדומות עד 180, שנה עד שנה וחצי",
     q(DORMANT, "last_order_date >= -540d", "amount_spent <= 180"), "שמפו יומיומי",
     "הפלח הרדום הקטן והטרי ביותר. מתאים לבדיקה במוצאי שבת."),

    # 20 and 21 September: Yom Kippur. Nothing goes out.

    ("2026-09-22", "שלישי", "09:00", "ספט · מנויות שמעולם לא קנו",
     q("number_of_orders = 0"), "יום הקרקפת",
     "נרשמו ולא קנו. מוצר קרקפת במחיר יום הוא קנייה ראשונה בסיכון נמוך."),

    ("2026-09-23", "רביעי", "09:00", "ספט · רדומות עד 180, מעל שנה וחצי",
     q("last_order_date < -540d", "amount_spent <= 180"), "קרם צבע עם מסרק",
     "הפלח הרדום הגדול והקר ביותר. הצעה קלה להיכנס אליה."),

    ("2026-09-24", "חמישי", "09:00", "ספט · רדומות 180 עד 260",
     q(DORMANT, "amount_spent > 180", "amount_spent <= 260"), "ערכת הצביעה המלאה",
     "רדומות שכבר הוציאו מעל ממוצע. הצעה של ערכה שלמה."),

    ("2026-09-25", "שישי", "08:30", "ספט · רדומות מעל 260",
     q(DORMANT, "amount_spent > 260"), "ערכת צביעה ביתית",
     "הרדומות היקרות ביותר. שווה להן ערכה ולא מוצר בודד."),

    ("2026-09-26", "מוצ״ש", "20:30", "ספט · קוני אמלה וגם קיק",
     q(has("amla"), has("castor")), "יום השמנים",
     "הקבוצה הכי מחויבת בצד השיער, ושלושה שמנים ביום אחד."),

    ("2026-09-27", "ראשון", "09:00", "ספט · קוני מסכה וגם סרום",
     q(has("elastic"), has("hyaluron")), "פילינג גוף מאצ'ה",
     "קוני הטיפוח לפנים. פילינג גוף הוא ההרחבה הטבעית."),

    ("2026-09-28", "שני", "09:00", "ספט · קוני מסכה בלבד",
     q(has("elastic"), "NOT " + has("hyaluron")), "יום הפנים",
     "קנו מסכה ומעולם לא סרום. יום שלושת הסרומים נועד להן."),

    ("2026-09-29", "שלישי", "09:00", "ספט · הוציאו מעל 300 שקל",
     q("amount_spent > 300"), "שמן בטאנה 120",
     "הקהל שמוכן לשלם, והמוצר היקר בקטלוג."),

    ("2026-09-30", "רביעי", "09:00", "ספט · הזדמנות אחרונה",
     q(), "הסט לשיער שעבר יותר מדי",
     "היום האחרון. השליחה הרחבה היחידה בתוכנית."),
]

# not promotional, and deliberately not subject to the ARRIVED exclusion: this
# is the one message the people waiting on a parcel actually want
SERVICE = ("שוטף · ממתינות למשלוח",
           "%s AND last_order_date >= -14d" % SUB,
           "עדכון משלוח. בלי מבצע.")


def size(query):
    try:
        return shopify.gql(COUNT, {"query": query})["customerSegmentMembers"]["totalCount"]
    except Exception:
        return None


def run():
    out, total = [], 0
    print("%-11s %-7s %-6s %-34s %5s  %s" % ("date", "day", "time", "segment", "size", "rides"))
    for date, dow, time_, name, query, day, why in PLAN:
        n = size(query)
        total += n or 0
        out.append({"date": date, "dow": dow, "time": time_, "name": name,
                    "query": query, "size": n, "promo_day": day, "why": why})
        print("%-11s %-7s %-6s %-34s %5s  %s" % (date, dow, time_, name[:34], n, day))

    name, query, why = SERVICE
    n = size(query)
    out.append({"date": "rolling", "dow": "", "time": "", "name": name,
                "query": query, "size": n, "promo_day": None, "why": why})

    print("\n%-13s %d sends, %d emails" % ("promotional:", len(PLAN), total))
    print("%-13s %s" % ("service:", n))
    print("%-13s %d of 10,000. headroom %d" % ("total:", total + (n or 0),
                                               10000 - total - (n or 0)))
    print("%-13s %d" % ("average send:", total // len(PLAN)))

    json.dump(out, open(os.path.join(HERE, "send_plan.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    return out


if __name__ == "__main__":
    run()
