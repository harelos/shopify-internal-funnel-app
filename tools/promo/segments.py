# -*- coding: utf-8 -*-
"""Customer segments for the September promotion.

Shopify's Admin API can manage segments but cannot compose or send a Shopify
Email campaign; there is no mutation for it. So this builds the audiences, and
the campaigns themselves are drafted in the admin against these segments.

The segmentation is deliberately small. Five audiences that actually behave
differently is worth more than twenty that overlap, and with a 10,000 email
monthly allowance the constraint is relevance, not volume.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import shopify

SUB = "email_subscription_status = 'SUBSCRIBED'"

SEGMENTS = [
    dict(name="ספטמבר 26 · כל המנויים",
         query=SUB,
         why="the launch send. Everyone who agreed to hear from us."),

    dict(name="ספטמבר 26 · קנו בעבר ולא ב-90 יום",
         query="%s AND number_of_orders >= 1 AND last_order_date < -90d" % SUB,
         why="they already trusted the store once. The cheapest order to win "
             "back, and the catalogue is entirely new to them."),

    dict(name="ספטמבר 26 · מנויים שמעולם לא קנו",
         query="%s AND number_of_orders = 0" % SUB,
         why="they subscribed and stopped. A daily deal is a low-risk first "
             "purchase, which is exactly what this group needs."),

    dict(name="ספטמבר 26 · רוכשי NovaHair",
         query="%s AND products_purchased MATCHES (id = 9810095440167)" % SUB,
         why="they bought the colour product from the funnel. The new "
             "catalogue is the maintenance that protects what they bought."),

    dict(name="ספטמבר 26 · נטשו עגלה ב-30 יום",
         query="%s AND abandoned_checkout_date >= -30d" % SUB,
         why="they got as far as checkout. A dated offer is a reason to finish."),

    dict(name="ספטמבר 26 · לקוחות חוזרים",
         query="%s AND number_of_orders > 1" % SUB,
         why="the people who buy more than once. Worth a different tone: "
             "first look rather than a discount pitch."),
]

CREATE = """
mutation seg($name: String!, $query: String!) {
  segmentCreate(name: $name, query: $query) {
    segment { id name }
    userErrors { field message }
  }
}"""

LIST = '{ segments(first: 100) { nodes { id name query } } }'

COUNT = """
query c($query: String!) {
  customerSegmentMembers(first: 1, query: $query) {
    totalCount
  }
}"""


def run():
    existing = {s["name"]: s for s in shopify.gql(LIST)["segments"]["nodes"]}
    out = []
    for s in SEGMENTS:
        if s["name"] in existing:
            gid = existing[s["name"]]["id"]
            print("  exists %-34s" % s["name"][:34])
        else:
            r = shopify.gql(CREATE, {"name": s["name"], "query": s["query"]})["segmentCreate"]
            if r["userErrors"]:
                print("  FAILED %-34s %s" % (s["name"][:34], r["userErrors"]))
                continue
            gid = r["segment"]["id"]
            print("  created %-33s" % s["name"][:33])
        try:
            n = shopify.gql(COUNT, {"query": s["query"]})["customerSegmentMembers"]["totalCount"]
        except Exception:
            n = None
        out.append({"name": s["name"], "id": gid, "query": s["query"],
                    "size": n, "why": s["why"]})

    print()
    for o in out:
        print("  %-36s %s people" % (o["name"][:36], o["size"] if o["size"] is not None else "?"))

    json.dump(out, open(os.path.join(HERE, "segments.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    return out


if __name__ == "__main__":
    run()
