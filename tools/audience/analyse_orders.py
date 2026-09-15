# -*- coding: utf-8 -*-
"""What two years of orders actually say, so the segments are built on evidence.

Answers the questions the send plan depends on:
  which products carry the store, and which are long tails
  what the repurchase rhythm looks like, so timing is not guesswork
  what gets bought together, which is what a cross-sell send needs
  how many parcels are in the air right now, because those customers should
    not get a promotion email on top of a delivery they are still waiting for
"""
import collections, datetime as dt, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
rows = json.load(open(os.path.join(HERE, "raw", "orders.json"), encoding="utf-8"))

IL = dt.timezone(dt.timedelta(hours=3))
NOW = dt.datetime.now(IL)


def when(s):
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(IL)


live = [o for o in rows if not o.get("cancelled")]
print("orders: %d total, %d not cancelled" % (len(rows), len(live)))
print("range : %s to %s" % (when(live[0]["created"]).date(), when(live[-1]["created"]).date()))

paid = [o for o in live if o.get("financial") in ("PAID", "PARTIALLY_REFUNDED")]
rev = sum(o["total"] for o in paid)
print("paid  : %d orders, %.0f ILS, AOV %.0f ILS" % (len(paid), rev, rev / max(1, len(paid))))

# ---------------------------------------------------------------- by month
print("\nORDERS BY MONTH (last 14)")
bym = collections.Counter(when(o["created"]).strftime("%Y-%m") for o in live)
for m in sorted(bym)[-14:]:
    print("  %s  %4d %s" % (m, bym[m], "#" * min(60, bym[m] // 3)))

# ---------------------------------------------------------------- products
print("\nTOP PRODUCTS BY ORDERS (2 years)")
byp = collections.Counter()
for o in live:
    for it in o["items"]:
        if it.get("title"):
            byp[(it["title"], it.get("handle"))] += 1
for (t, h), n in byp.most_common(22):
    print("  %4d  %-52s %s" % (n, t[:52], (h or "")[:28]))

print("\ndistinct products ever ordered: %d" % len(byp))

# ------------------------------------------------------- basket composition
sizes = collections.Counter(min(sum(i["qty"] for i in o["items"]), 6) for o in live)
print("\nITEMS PER ORDER")
for k in sorted(sizes):
    print("  %s%-3s %4d" % ("" if k < 6 else ">=", k, sizes[k]))

multi = sum(1 for o in live if len({i["handle"] for i in o["items"] if i.get("handle")}) > 1)
print("orders with more than one distinct product: %d (%.0f%%)"
      % (multi, 100.0 * multi / max(1, len(live))))

# -------------------------------------------------------------- affinity
print("\nBOUGHT TOGETHER (distinct product pairs, top 12)")
pairs = collections.Counter()
for o in live:
    hs = sorted({i["handle"] for i in o["items"] if i.get("handle")})
    for a in range(len(hs)):
        for b in range(a + 1, len(hs)):
            pairs[(hs[a], hs[b])] += 1
for (a, b), n in pairs.most_common(12):
    print("  %3d  %-34s + %s" % (n, a[:34], b[:34]))

# ------------------------------------------------------------- deliveries
print("\nPARCELS IN THE AIR RIGHT NOW")
state = collections.Counter(o.get("fulfillment") for o in live)
for k, v in state.most_common():
    print("  %-22s %d" % (k, v))

recent = [o for o in live if (NOW - when(o["created"])).days <= 45]
in_air, delivered, unfulfilled = 0, 0, 0
eta_soon = 0
for o in recent:
    if o.get("fulfillment") == "FULFILLED":
        ships = o.get("ship") or []
        d = any(s.get("delivered") for s in ships)
        if d:
            delivered += 1
        else:
            in_air += 1
            for s in ships:
                if s.get("eta"):
                    days = (when(s["eta"]) - NOW).days
                    if 0 <= days <= 7:
                        eta_soon += 1
                        break
    else:
        unfulfilled += 1
print("\nlast 45 days: %d orders" % len(recent))
print("  delivered              %d" % delivered)
print("  shipped, not delivered %d" % in_air)
print("  not yet shipped        %d" % unfulfilled)
print("  with an ETA inside 7 days %d" % eta_soon)

# ------------------------------------------------------------- recency map
print("\nORDER RECENCY (not cancelled)")
buckets = collections.Counter()
for o in live:
    d = (NOW - when(o["created"])).days
    b = ("0-30" if d <= 30 else "31-90" if d <= 90 else "91-180" if d <= 180
         else "181-365" if d <= 365 else "365+")
    buckets[b] += 1
for b in ["0-30", "31-90", "91-180", "181-365", "365+"]:
    print("  %-8s %4d" % (b, buckets[b]))
