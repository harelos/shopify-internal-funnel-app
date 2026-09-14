# -*- coding: utf-8 -*-
"""Daily check that the promotion page and the real discounts agree.

The page rotates itself and Shopify switches the discounts on and off by their
own timestamps, so this does not drive the promotion. It verifies it, and it is
the thing that catches the failures that would otherwise go unnoticed for a day:
a hero product that sold out, a discount someone disabled by hand, a day the
calendar promises and no discount exists for.

Prints a report and exits non-zero when something needs a person.
"""
import datetime as dt
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import shopify

IL = dt.timezone(dt.timedelta(hours=3))     # Asia/Jerusalem in September


def today_str():
    return dt.datetime.now(IL).strftime("%Y-%m-%d")


CAL_Q = '{ shop { metafield(namespace:"nova", key:"promo_calendar") { value } } }'

PROD_Q = """
query p($q: String!) {
  products(first: 1, query: $q) {
    nodes {
      handle title status publishedAt totalInventory tracksInventory
      variants(first: 1) { nodes { price availableForSale } }
    }
  }
}"""

DISC_Q = """
query d($q: String!) {
  automaticDiscountNodes(first: 100, query: $q) {
    nodes {
      id
      automaticDiscount {
        ... on DiscountAutomaticBasic {
          title status startsAt endsAt
          customerGets { value { ... on DiscountPercentage { percentage } } }
        }
      }
    }
  }
}"""


def run():
    issues, notes = [], []
    today = today_str()
    notes.append("date (Asia/Jerusalem): %s" % today)

    mf = shopify.gql(CAL_Q)["shop"]["metafield"]
    if not mf:
        print("FAIL: the promo calendar metafield is missing entirely.")
        return 1
    cal = json.loads(mf["value"])

    days = {d["date"]: d for d in cal.get("days", [])}
    notes.append("calendar covers %s to %s (%d days)"
                 % (cal["days"][0]["date"], cal["days"][-1]["date"], len(cal["days"])))

    # is the run about to end without a replacement
    last = cal["days"][-1]["date"]
    days_left = (dt.date.fromisoformat(last) - dt.date.fromisoformat(today)).days
    if days_left < 0:
        issues.append("The calendar ended on %s. The page is showing the closed state. "
                      "Build next month." % last)
    elif days_left <= 3:
        issues.append("Only %d day(s) of calendar left (ends %s). Build next month now."
                      % (days_left, last))

    day = days.get(today)
    if day is None:
        notes.append("no row for today, page shows the closed state (this is correct "
                     "outside the run)")
    elif day.get("dark"):
        notes.append("today is a dark day (%s). No offer and no email is correct."
                     % day.get("dark_title"))
        live = shopify.gql(DISC_Q, {"q": "NovaDeal"})["automaticDiscountNodes"]["nodes"]
        for n in live:
            a = n["automaticDiscount"] or {}
            if not a.get("startsAt"):
                continue
            when = dt.datetime.fromisoformat(a["startsAt"].replace("Z", "+00:00")).astimezone(IL)
            if a.get("status") == "ACTIVE" and when.strftime("%Y-%m-%d") == today:
                issues.append("A discount is ACTIVE on a dark day: %s" % a.get("title"))
    else:
        handle = (day.get("handles") or [day.get("handle")])[0]
        pn = shopify.gql(PROD_Q, {"q": "handle:%s" % handle})["products"]["nodes"]
        if not pn:
            issues.append("Today's product '%s' does not exist." % handle)
        else:
            p = pn[0]
            v = p["variants"]["nodes"][0]
            notes.append("today's hero: %s at %s ILS, %d%% off"
                         % (handle, v["price"], day["percent_off"]))
            if p["status"] != "ACTIVE":
                issues.append("Today's product is %s, so the page cannot show the offer. "
                              "Publish it or move the day." % p["status"])
            if p["publishedAt"] is None:
                issues.append("Today's product is not published to the online store.")
            if not v["availableForSale"]:
                issues.append("Today's product is not available for sale.")
            if p["tracksInventory"] and (p["totalInventory"] or 0) <= 0:
                issues.append("Today's product tracks inventory and is at %s."
                              % p["totalInventory"])

        # the discount that actually changes the price
        # Shopify returns startsAt in UTC. A window that opens at midnight in
        # Israel therefore comes back stamped with the previous date, which is
        # why comparing the raw prefix reported a missing discount that was in
        # fact running. Compare the actual instant instead.
        live = shopify.gql(DISC_Q, {"q": "NovaDeal"})["automaticDiscountNodes"]["nodes"]
        match = []
        for n in live:
            a = n["automaticDiscount"] or {}
            t = a.get("title") or ""
            if not t.startswith("NovaDeal ") or t.startswith("NovaDeal week"):
                continue
            starts = a.get("startsAt")
            if not starts:
                continue
            when = dt.datetime.fromisoformat(starts.replace("Z", "+00:00")).astimezone(IL)
            if when.strftime("%Y-%m-%d") == today:
                match.append(n)
        if not match:
            issues.append("No automatic discount is scheduled for today. The page would "
                          "advertise a price the cart does not honour.")
        else:
            a = match[0]["automaticDiscount"]
            pct = round((a["customerGets"]["value"].get("percentage") or 0) * 100)
            if pct != day["percent_off"]:
                issues.append("Discount is %d%% but the calendar says %d%%. The page and "
                              "the cart disagree." % (pct, day["percent_off"]))
            if a["status"] != "ACTIVE":
                issues.append("Today's discount exists but its status is %s." % a["status"])
            else:
                notes.append("discount ACTIVE at %d%%, ends %s" % (pct, a["endsAt"]))

    # the running weekly offer
    wk = [w for w in cal.get("weeks", []) if w["from"] <= today <= w["to"]]
    if wk:
        w = wk[0]
        live = shopify.gql(DISC_Q, {"q": "NovaDeal week"})["automaticDiscountNodes"]["nodes"]
        act = [n for n in live if n["automaticDiscount"].get("status") == "ACTIVE"]
        if not act:
            issues.append("The weekly offer '%s' is on the calendar but no weekly "
                          "discount is active." % w["title"])
        else:
            notes.append("weekly offer active: %s" % w["title"])

    print("PROMOTION CHECK")
    for n in notes:
        print("  " + n)
    print()
    if issues:
        print("NEEDS ATTENTION (%d):" % len(issues))
        for i in issues:
            print("  - " + i)
        return 1
    print("Everything matches the calendar. No action needed.")
    return 0


if __name__ == "__main__":
    sys.exit(run())
