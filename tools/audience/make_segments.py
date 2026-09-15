# -*- coding: utf-8 -*-
"""Create the September audiences, and retire the ones they replace.

`segmentCreate` refuses any query containing `products_purchased MATCHES`, even
though the query engine behind `customerSegmentMembers` accepts the identical
string. So the behavioural segments go in by API and the five product-based ones
are reported for creation in the admin, where the same query is accepted.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import shopify

CREATE = """
mutation s($name: String!, $query: String!) {
  segmentCreate(name: $name, query: $query) {
    segment { id name }
    userErrors { field message }
  }
}"""
DELETE = 'mutation d($id: ID!) { segmentDelete(id: $id) { deletedSegmentId userErrors { message } } }'
LIST = '{ segments(first: 150) { nodes { id name query } } }'

# the first, coarser attempt at segmentation. Superseded by the plan built on
# two years of order history, so they are removed rather than left to confuse.
RETIRE_PREFIX = "ספט · "  # the plan is rebuilt from scratch each time


def run():
    plan = json.load(open(os.path.join(HERE, "send_plan.json"), encoding="utf-8"))
    existing = {s["name"]: s for s in shopify.gql(LIST)["segments"]["nodes"]}

    gone = 0
    for name, s in list(existing.items()):
        if name.startswith(RETIRE_PREFIX):
            r = shopify.gql(DELETE, {"id": s["id"]})["segmentDelete"]
            if not r["userErrors"]:
                gone += 1
                existing.pop(name, None)
    print("retired %d superseded segments\n" % gone)

    api_ok, manual = [], []
    for row in plan:
        name, q = row["name"], row["query"]
        if name in existing:
            print("  exists  %-38s" % name[:38])
            api_ok.append(row)
            continue
        r = shopify.gql(CREATE, {"name": name, "query": q})["segmentCreate"]
        if r["userErrors"]:
            msg = r["userErrors"][0]["message"]
            if "MATCHES" in msg:
                manual.append(row)
                print("  BY HAND %-38s (product filter, API refuses it)" % name[:38])
            else:
                print("  FAILED  %-38s %s" % (name[:38], msg[:60]))
            continue
        api_ok.append(row)
        print("  created %-38s %s people" % (name[:38], row["size"]))

    print("\n%d created or present by API, %d need the admin" % (len(api_ok), len(manual)))
    if manual:
        print("\nPaste these into Customers > Segments > Create segment:")
        for row in manual:
            print("\n  name : %s" % row["name"])
            print("  query: %s" % row["query"])
    json.dump({"api": api_ok, "manual": manual},
              open(os.path.join(HERE, "segments_status.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)


if __name__ == "__main__":
    run()
