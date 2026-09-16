# -*- coding: utf-8 -*-
"""Put a subscribe-and-save option on the products people actually run out of.

A subscription only makes sense where the product is consumed on a predictable
clock. A toner lasts about two months, a cleanser about two, an ampoule course
one. A gua sha stone lasts years, and offering "deliver every month" on a lump
of jade reads as careless rather than convenient, so the five tools are
excluded by name and not by accident.

Two intervals, because the shelf has two rhythms:

  every 30 days   the daily items: cleansers, toners, creams, exfoliants
  every 60 days   the slower ones: ampoules and essences, which are used a few
                  drops at a time and outlast a month comfortably

The discount is 15%, which sits deliberately below the club's own tier so that
subscribing never undercuts the club and the two can be held at the same time.
Anything steeper on an 80% margin would also train the customer to wait for it.

Selling plans attach to products, not to variants, so this is safe to rerun:
productJoinSellingPlanGroups is idempotent for a product already in the group.

WHAT THIS DOES NOT DO, and it matters more than what it does.

The groups this creates come back with `appId: null`, because they were made by
the Admin API rather than by an app that holds subscription capability. Shopify
will store them, attach them to products and show them in the admin, and it will
not sell them. No frequency selector appears on the product page, and there is
no contract to bill against, so a customer cannot subscribe to any of them. The
live product page was checked and has no selector.

So treat everything below as the pricing and the grouping decided in advance,
not as a working subscription. To make it real: install Shopify Subscriptions,
which is first party and free, and recreate these two groups through it. The
intervals, the 15% and the exclusion list are the parts worth keeping, and they
are the parts that took the thinking.
"""
import io, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import copy_glow
import shopify

# tool handles never get a subscription option
TOOLS = {d["handle"] for d in copy_glow.TOOLS}

# the slower-burn shelves go on the 60 day clock
SLOW_TYPES = {"אמפולה", "אסנס"}

GROUP_CREATE = """
mutation g($input: SellingPlanGroupInput!, $resources: SellingPlanGroupResourceInput) {
  sellingPlanGroupCreate(input: $input, resources: $resources) {
    sellingPlanGroup { id name sellingPlans(first: 5) { nodes { id name } } }
    userErrors { field message }
  }
}
"""

JOIN = """
mutation j($id: ID!, $productIds: [ID!]!) {
  sellingPlanGroupAddProducts(id: $id, productIds: $productIds) {
    sellingPlanGroup { id }
    userErrors { field message }
  }
}
"""


def plan(name, interval_days, percent):
    return {
        "name": name,
        "options": [name],
        "category": "SUBSCRIPTION",
        "billingPolicy": {"recurring": {"interval": "DAY", "intervalCount": interval_days}},
        "deliveryPolicy": {"recurring": {"interval": "DAY", "intervalCount": interval_days}},
        "pricingPolicies": [{
            "fixed": {
                "adjustmentType": "PERCENTAGE",
                "adjustmentValue": {"percentage": float(percent)},
            }
        }],
    }


def group_input(name, plans):
    return {
        "name": name,
        "merchantCode": name,
        "options": ["תדירות משלוח"],
        "position": 1,
        "sellingPlansToCreate": plans,
    }


def ensure_groups():
    """Create the two groups once, and remember their ids."""
    path = os.path.join(HERE, "selling_plans.json")
    if os.path.exists(path):
        return json.load(io.open(path, encoding="utf-8"))

    out = {}
    specs = [
        ("monthly", "מנוי חודשי", plan("כל 30 יום, 15% הנחה", 30, 15)),
        ("bimonthly", "מנוי דו חודשי", plan("כל 60 יום, 15% הנחה", 60, 15)),
    ]
    for key, name, p in specs:
        d = shopify.gql(GROUP_CREATE, {"input": group_input(name, [p]), "resources": None})
        r = d["sellingPlanGroupCreate"]
        if r["userErrors"]:
            raise RuntimeError("%s: %s" % (name, r["userErrors"]))
        out[key] = r["sellingPlanGroup"]["id"]
        print("created group %-12s %s" % (key, out[key]))
    json.dump(out, io.open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return out


def run():
    published = json.load(io.open(os.path.join(HERE, "published_glow.json"), encoding="utf-8"))
    by_src = {d["src"]: d for d in copy_glow.ALL}

    groups = ensure_groups()
    buckets = {"monthly": [], "bimonthly": []}
    skipped = []

    for src, rec in published.items():
        it = by_src[int(src)]
        if it["handle"] in TOOLS:
            skipped.append(it["title"])
            continue
        key = "bimonthly" if it["ptype"] in SLOW_TYPES else "monthly"
        buckets[key].append(rec["gid"])

    for key, gids in buckets.items():
        for i in range(0, len(gids), 25):          # the mutation caps at 25
            chunk = gids[i:i + 25]
            d = shopify.gql(JOIN, {"id": groups[key], "productIds": chunk})
            errs = d["sellingPlanGroupAddProducts"]["userErrors"]
            if errs:
                print("FAILED %s: %s" % (key, errs))
            else:
                print("%-10s +%d products" % (key, len(chunk)))

    print("\nsubscription offered on %d products" % sum(len(v) for v in buckets.values()))
    print("deliberately excluded, they are not consumables:")
    for t in skipped:
        print("   " + t)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    run()
