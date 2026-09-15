# -*- coding: utf-8 -*-
"""Pull the whole order history to disk so segmentation is built on facts.

Two years, ~3,450 orders. Everything stays local; nothing about the catalogue or
the customer list passes through the conversation. What matters per order is the
customer, the date, what was bought, what was paid, and crucially whether the
parcel has actually arrived, because a promotion email to someone still waiting
on a delivery reads badly.
"""
import json, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import shopify

OUT = os.path.join(HERE, "raw", "orders.json")
os.makedirs(os.path.dirname(OUT), exist_ok=True)

Q = """
query o($cursor: String) {
  orders(first: 100, after: $cursor, sortKey: CREATED_AT, reverse: false,
         query: "status:any") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt cancelledAt
      displayFinancialStatus
      displayFulfillmentStatus
      currentTotalPriceSet { shopMoney { amount } }
      fulfillments(first: 5) {
        createdAt
        displayStatus
        estimatedDeliveryAt
        deliveredAt
        inTransitAt
      }
      lineItems(first: 25) {
        nodes {
          quantity
          product { id handle title productType vendor }
        }
      }
    }
  }
}"""


def run():
    rows, cursor, page = [], None, 0
    while True:
        d = shopify.gql(Q, {"cursor": cursor})["orders"]
        for o in d["nodes"]:
            f = (o.get("fulfillments") or [])
            rows.append({
                "id": o["id"], "name": o["name"],
                "created": o["createdAt"],
                "cancelled": o.get("cancelledAt"),
                "financial": o.get("displayFinancialStatus"),
                "fulfillment": o.get("displayFulfillmentStatus"),
                "total": float((o.get("currentTotalPriceSet") or {}).get("shopMoney", {}).get("amount") or 0),
                "ship": [{
                    "created": x.get("createdAt"),
                    "status": x.get("displayStatus"),
                    "eta": x.get("estimatedDeliveryAt"),
                    "delivered": x.get("deliveredAt"),
                    "in_transit": x.get("inTransitAt"),
                } for x in f],
                "items": [{
                    "qty": li["quantity"],
                    "pid": ((li.get("product") or {}).get("id")),
                    "handle": ((li.get("product") or {}).get("handle")),
                    "title": ((li.get("product") or {}).get("title")),
                    "type": ((li.get("product") or {}).get("productType")),
                    "vendor": ((li.get("product") or {}).get("vendor")),
                } for li in o["lineItems"]["nodes"]],
            })
        page += 1
        print("  page %-3d total %d" % (page, len(rows)))
        sys.stdout.flush()
        if not d["pageInfo"]["hasNextPage"]:
            break
        cursor = d["pageInfo"]["endCursor"]
        time.sleep(0.25)

    json.dump(rows, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
    print("\nsaved %d orders" % len(rows))


if __name__ == "__main__":
    run()
