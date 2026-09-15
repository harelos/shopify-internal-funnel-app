# -*- coding: utf-8 -*-
"""Measure every candidate audience before committing to a send plan.

`segmentCreate` refuses `products_purchased MATCHES`, but the query engine
behind `customerSegmentMembers` accepts it, so sizes can be measured exactly
even for the segments that have to be created by hand in the admin. Sizing
first is the point: with 10,000 sends a month and 2,663 subscribers, guessing
at audience size is guessing at a quarter of the month.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import shopify

COUNT = 'query c($query: String!) { customerSegmentMembers(first: 1, query: $query) { totalCount } }'

SUB = "email_subscription_status = 'SUBSCRIBED'"

# the four SKUs two years of orders actually ran on
P = {
    "elastic":  9671746683175,   # מסיכת קולגן לילה, 1418 orders
    "hyaluron": 9695478677799,   # סרום היאלורוני 4 ב-1, 1021
    "amla":     9566713905447,   # שמפו אמלה OCEAURA, 1008
    "castor":   9608345944359,   # שמן קיק שחור, 420
    "novahair": 10341269274919,  # ערכת הצביעה מהפאנל, 92
}


def bought(key):
    return "products_purchased MATCHES (id = %d)" % P[key]


CANDIDATES = [
    # ---- reach
    ("כל המנויים", SUB),
    ("כלל הלקוחות במאגר", "number_of_orders >= 0"),

    # ---- what they bought: the skincare side
    ("קנו מסכת קולגן", "%s AND %s" % (SUB, bought("elastic"))),
    ("קנו סרום היאלורוני", "%s AND %s" % (SUB, bought("hyaluron"))),
    ("קנו מסכה וגם סרום", "%s AND %s AND %s" % (SUB, bought("elastic"), bought("hyaluron"))),
    ("קנו מסכה בלבד", "%s AND %s AND NOT %s" % (SUB, bought("elastic"), bought("hyaluron"))),

    # ---- what they bought: the hair side
    ("קנו שמפו אמלה", "%s AND %s" % (SUB, bought("amla"))),
    ("קנו שמן קיק", "%s AND %s" % (SUB, bought("castor"))),
    ("קנו אמלה וגם קיק", "%s AND %s AND %s" % (SUB, bought("amla"), bought("castor"))),
    ("קנו אמלה בלבד", "%s AND %s AND NOT %s" % (SUB, bought("amla"), bought("castor"))),
    ("קנו ערכת צביעה NovaHair", "%s AND %s" % (SUB, bought("novahair"))),

    # ---- crossover, the interesting one
    ("קנו גם טיפוח פנים וגם שיער",
     "%s AND %s AND %s" % (SUB, bought("elastic"), bought("amla"))),

    # ---- behaviour
    ("לקוחות חוזרים", "%s AND number_of_orders > 1" % SUB),
    ("קנו פעם אחת בלבד", "%s AND number_of_orders = 1" % SUB),
    ("מנויים שמעולם לא קנו", "%s AND number_of_orders = 0" % SUB),

    # ---- recency, which is barbelled on this store
    ("קנו ב-30 הימים האחרונים", "%s AND last_order_date >= -30d" % SUB),
    ("קנו לפני 30 עד 90 יום", "%s AND last_order_date < -30d AND last_order_date >= -90d" % SUB),
    ("רדומים 6 עד 12 חודשים", "%s AND last_order_date < -180d AND last_order_date >= -365d" % SUB),
    ("רדומים מעל שנה", "%s AND last_order_date < -365d" % SUB),

    # ---- value
    ("הוציאו מעל 300 שקל", "%s AND amount_spent > 300" % SUB),
    ("הוציאו מעל 500 שקל", "%s AND amount_spent > 500" % SUB),

    # ---- intent
    ("נטשו עגלה ב-30 יום", "%s AND abandoned_checkout_date >= -30d" % SUB),
    ("נטשו עגלה ב-90 יום", "%s AND abandoned_checkout_date >= -90d" % SUB),
]


def run():
    out = []
    for name, q in CANDIDATES:
        try:
            n = shopify.gql(COUNT, {"query": q})["customerSegmentMembers"]["totalCount"]
        except Exception as e:
            print("  %-30s ERROR %s" % (name[:30], str(e)[-70:]))
            continue
        out.append({"name": name, "query": q, "size": n})
        print("  %-30s %5d" % (name[:30], n))
    json.dump(out, open(os.path.join(HERE, "segment_sizes.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    return out


if __name__ == "__main__":
    run()
