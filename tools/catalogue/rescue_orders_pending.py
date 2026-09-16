# -*- coding: utf-8 -*-
"""Two service-recovery orders, ready to create the moment the postcodes arrive.

Everything else is verified against CJ's own record of what was already shipped
to these two customers, so nothing here is guessed except the one field that is
deliberately left blank.

WHY THIS IS NOT CREATED YET

CJ rejects an order without a postcode and an email. The postcodes are not
recoverable from anything this session can read: CJ's order API does not return
`shippingZip` on either the list or the detail endpoint, and the Shopify Admin
token is blocked from the Customer object entirely, which takes addresses with
it. The project's own rescue PRD is explicit about what to do next:

    "Never invent a missing postcode. Obtain it from an authoritative source
     or pause that order and report the blocker."

So this pauses. Fill in ZIPS below from the Shopify admin order pages and run.

WHERE EACH FIELD CAME FROM

  name, phone, street, city   CJ order RESCUE-4379 and RESCUE-4365, which are
                              the parcels that actually reached these two
  light brown variant         vid ...624400, the exact variant CJ shipped to
                              מלי against a Shopify line reading
                              "4 בקבוקים / חום בהיר". The shade is encoded in
                              the vid: ...624400 is light brown, ...624700 is
                              the purple לילך received.
  rosemary set                vid 2605071321561619700, the only variant of
                              CJYD2586872 that is shampoo AND conditioner
                              together, which is what the store sells as
                              "סט שמפו ומרכך" and what was sent to מלי on
                              WhatsApp this morning
  carrier                     CJPacket YP Special Line, the same line both
                              previous parcels used
"""
import io, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

# ---------------------------------------------------------------- FILL THESE
# Shopify admin -> Orders -> #4379 / #4365 -> shipping address -> postcode.
ZIPS = {
    "4379": "",     # מלי לוי, רבי יהודה הנשיא 16, פתח תקווה
    "4365": "",     # לילך שמילוביץ, יצחק בן צבי 10, קרית מוצקין
}
# CJ requires an email on the order. The store's own address is used rather
# than the customers', because their addresses are behind the same PII wall as
# the postcodes and CJ only uses this for order notifications.
NOTIFY_EMAIL = "info@tigerbrandsglobal.com"
# ---------------------------------------------------------------------------

LIGHT_BROWN = "2412030839551624400"
ROSEMARY_DUO = "2605071321561619700"
CARRIER = "CJPacket YP Special Line"

ORDERS = [
    {
        "key": "4379",
        "orderNumber": "RESCUE-4379-BROKEN-REPLACE",
        "shippingCustomerName": "מלי לוי",
        "shippingPhone": "0547170090",
        "shippingProvince": "פתח תקווה",
        "shippingCity": "פתח תקווה",
        "shippingAddress": "רבי יהודה הנשיא 16, דירה 8, קומה 2",
        "products": [
            {"vid": LIGHT_BROWN, "quantity": 2},
            {"vid": ROSEMARY_DUO, "quantity": 1},
        ],
        "remark": "Replacement for Shopify #4379. Two of the four bottles "
                  "arrived broken. Sending 2 light brown replacements plus the "
                  "rosemary shampoo and conditioner set as the promised gift. "
                  "Customer pays nothing.",
        "expect": "goods $6.16 + freight $40.01 = $46.17",
    },
    {
        "key": "4365",
        "orderNumber": "RESCUE-4365-LIGHTBROWN",
        "shippingCustomerName": "לילך שמילוביץ",
        "shippingPhone": "0528603322",
        "shippingProvince": "קרית מוצקין",
        "shippingCity": "קרית מוצקין",
        "shippingAddress": "יצחק בן צבי 10",
        "products": [{"vid": LIGHT_BROWN, "quantity": 2}],
        "remark": "Shopify #4365 follow-up. Customer originally received "
                  "purple; sending 2 bottles in light brown.",
        "expect": "goods $2.64 + freight $17.36 = $20.00",
    },
]


def build(o):
    return {
        "orderNumber": o["orderNumber"],
        "shippingCustomerName": o["shippingCustomerName"],
        "shippingPhone": o["shippingPhone"],
        "shippingCountry": "Israel",
        "shippingCountryCode": "IL",
        "shippingProvince": o["shippingProvince"],
        "shippingCity": o["shippingCity"],
        "shippingAddress": o["shippingAddress"],
        "shippingZip": ZIPS[o["key"]],
        "email": NOTIFY_EMAIL,
        "logisticName": CARRIER,
        "fromCountryCode": "CN",
        # 3 creates the order without paying. Balance is $20.20 against $66.17
        # of orders, so paying here would half-fail and leave one order in an
        # unclear state.
        "payType": 3,
        "isSandbox": 0,
        "remark": o["remark"],
        "products": o["products"],
    }


def main():
    missing = [k for k, v in ZIPS.items() if not v.strip()]
    if missing:
        print("PAUSED. No postcode for: %s" % ", ".join("#" + m for m in missing))
        print("Fill ZIPS at the top of this file from the Shopify admin, then rerun.")
        print()
        for o in ORDERS:
            print("  %-26s %s" % (o["orderNumber"], o["expect"]))
            print("      %s, %s, %s" % (o["shippingCustomerName"],
                                        o["shippingAddress"], o["shippingCity"]))
            for p in o["products"]:
                print("      %dx %s" % (p["quantity"], p["vid"]))
        return 1

    print("Postcodes present. Payloads ready:\n")
    for o in ORDERS:
        print(json.dumps(build(o), ensure_ascii=False, indent=1))
        print()
    print("Create them with the CJ create_order tool, one payload each.")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
