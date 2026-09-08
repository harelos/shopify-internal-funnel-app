# Shipment Control runbook

Shipment Control is the owner-facing order-risk workspace for chargeback
prevention and post-purchase trust. It is not a fulfillment engine and it never
sends a customer message, pays CJ, cancels an order, or issues a refund.

## Source contract

- Shopify is authoritative for payment, refund/cancellation state, successful
  `SALE` transactions, fraud-risk recommendation, and fulfillment state.
- The authenticated CJ API is authoritative for the CJ order, payment state,
  warehouse state, tracking number, and CJ tracking checkpoints.
- A public tracking page returning “not found” is not proof that a CJ order does
  not exist.
- AfterShip is an optional future fallback only when CJ cannot identify a real
  tracking number. It may not overwrite newer CJ evidence.
- Provider outages produce a visible partial/stale state. Missing evidence is
  never silently converted into a shipment conclusion.

## Runtime architecture

1. The existing Railway fulfillment worker continues its 15-minute order and
   tracking reconciliation unchanged.
2. At the latest due Israel-time checkpoint (09:00, 15:00, or 21:00), the same
   worker reads Shopify and authenticated CJ evidence, removes customer PII,
   scores the order, and posts a signed snapshot to Commerce OS.
3. Cloudflare accepts the snapshot only with `SHIPMENT_BRIDGE_TOKEN`, stores the
   latest evidence in D1, and keeps owner workflow state across refreshes.
4. The embedded Shopify page reads D1 through the existing authenticated Admin
   session and presents priority, reason, exact next action, and contact target.
5. Every workflow-state change is written to `ShipmentActionLog`.

## Default thresholds

- Tracking absent after 2 Israeli business days: High.
- Tracking absent after 5 Israeli business days: Critical.
- Label without physical pickup after 2 business days: High.
- Label without physical pickup after 5 business days: Critical.
- No new in-transit checkpoint for 3 calendar days: Medium review.
- Business day 10 without delivery: proactive customer-update draft due.
- Business day 14 without delivery: concrete remedy decision due.
- Carrier exception, return-to-sender, undeliverable, or failed delivery: same-day Critical.
- More than one successful Shopify `SALE`: manual AfterSell/charge review.
- Shopify `INVESTIGATE`: manual review. Shopify `CANCEL`: urgent review. Neither cancels automatically.

Business days use `Asia/Jerusalem` and exclude Friday and Saturday.

## Owner workflow

- `NEW`: evidence changed or a new actionable issue appeared.
- `ACKNOWLEDGED`: the owner has seen it.
- `ASSIGNED`: the owner accepted responsibility.
- `WAITING_FOR_CJ`: a supplier case is open.
- `CUSTOMER_UPDATED`: an approved customer update was sent outside this screen.
- `RESOLVED`: no further owner action is currently required.

If an inactive issue returns or the primary risk changes, the case reopens as
`NEW`. A refresh never erases the audit history.

## Verified correction on 2026-09-08

Authenticated CJ reconciliation found 59 unique `RESCUE-*` orders plus one
duplicate-CJ conflict. Orders #4369–#4377 exist in CJ; #4369 was verified as
shipped with current physical movement. Therefore the earlier spreadsheet claim
that those orders were absent from CJ was false and must not be used for customer
or supplier communication.

Examples of the real current issue types found during the same read:

- #4378: tracking exists, but CJ still reported an unshipped/processing state
  and only a label-created checkpoint.
- #4414–#4416: Shopify-paid orders were still `IN_CART` and unpaid in CJ.
- #4365: more than one CJ rescue record; excluded from automated fulfillment and
  surfaced for manual reconciliation.

No customer PII, raw access token, full tracking number, or message body belongs
in this repository or in the snapshot bridge.
