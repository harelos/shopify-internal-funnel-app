# NovaHair Lifecycle V2 — research, strategy and chargeback prevention

Status: implementation specification. Customer-facing changes and new sends must be created disabled and pass the QA gates in this document before activation.

Updated: 2026-09-12

## Executive decision

NovaHair should not try to prevent chargebacks with a threatening message after a dispute is filed. The most effective and defensible system is an order-assurance state machine that reduces the reasons a customer reaches that point:

1. Make the purchase and the billing descriptor recognizable.
2. Set accurate expectations: delivery to an Israeli pickup point normally takes 5–14 business days from the order date; tracking may appear later.
3. Send an update only when the order state or risk state justifies one.
4. Detect missing tracking, stalled parcels, carrier exceptions, pickup availability and failed delivery early.
5. Give the customer one easy path to a human reply and pause promotional email while a service issue is open.
6. Keep a signed, timestamped evidence timeline in case prevention fails.

The proposed system keeps the existing 41-email lifecycle catalog, rewrites weak or repetitive messages, and adds conditional operational templates. A customer never receives every template. Stage progression, service state, consent, suppression, frequency caps and purchase status decide what is eligible.

## What the primary sources support

- Shopify recommends a recognizable billing statement name, clear return/shipping policies, receipts, shipping updates, tracking and delivery confirmation, and proactive contact when a shipment is delayed. It also recommends resolving customer concerns quickly before they become chargebacks. [Shopify: preventing chargebacks](https://help.shopify.com/en/manual/payments/chargebacks/preventing-chargebacks)
- Shopify's chargeback evidence guidance prioritizes delivery confirmation, customer communications, policy acceptance and order history. Evidence should be captured as durable files or records rather than depending on links that can change. [Shopify: chargeback process and evidence](https://help.shopify.com/en/manual/payments/chargebacks/chargeback-process)
- Shopify Payments allows a customer statement name and support phone. The statement name must represent the store, legal entity, DBA or URL; the processor or bank can still alter how the final statement is displayed. [Shopify Payments configuration](https://help.shopify.com/en/manual/payments/shopify-payments/configuring-shopify-payments)
- Visa recommends clear policies, notifying customers of delays and revised delivery expectations, and obtaining acknowledgement after delivery. It also identifies descriptor confusion and weak purchase/delivery communication as common friendly-fraud drivers. [Visa dispute resolution](https://www.visa.com/en-us/support/business/dispute-resolution), [Visa on friendly fraud](https://corporate.visa.com/en/solutions/visa-protect/insights/friendly-fraud.html)
- Shopify fulfillment data can expose tracking information, display status, delivery estimates and timestamped events. Its event vocabulary distinguishes carrier pickup, in transit, delayed, out for delivery, ready for pickup, picked up, delivered, attempted delivery, buyer action required and return to sender. [Shopify Fulfillment object](https://shopify.dev/docs/api/admin-graphql/latest/objects/Fulfillment), [fulfillment event statuses](https://shopify.dev/docs/api/customer/unstable/enums/FulfillmentEventStatus)
- Shopify exposes webhook topics for fulfillment creation/update, fulfillment events, order updates and Shopify Payments disputes. [Shopify webhook topics](https://shopify.dev/docs/api/admin-graphql/2026-04/enums/WebhookSubscriptionTopic)
- CJ's authenticated order API provides order/payment status, order amounts, product and postage amounts, tracking number and platform order identifiers. Its logistics API supports tracking lookup. [CJ order API](https://developers.cjdropshipping.com/en/api/api2/api/shopping_new.html), [CJ logistics API](https://developers.cjdropshipping.com/en/api/api2/api/logistic.html)
- Shopify may already send order, shipping, out-for-delivery and delivered notifications depending on store and carrier configuration. NovaHair must audit those settings before enabling overlapping Resend messages. [Shopify customer notifications](https://help.shopify.com/en/manual/fulfillment/setup/notifications/customer-notifications), [Shopify order tracking](https://help.shopify.com/en/manual/fulfillment/setup/order-status-page/order-tracking)

## Verified local capability

The CJ blocker described in an older chat is resolved. A local, authenticated CJ extraction has already produced a private August–September report with:

- 71 paid CJ orders;
- 63 matched to Shopify and 8 unmatched;
- order-level product, postage and total cost;
- line-level product cost;
- current CJPacket tracking state;
- 2 delivered, 29 en route, 24 dispatched and 16 processing at extraction time.

That implementation is a validated prototype, not a production service. Its useful pieces should be moved into the existing Cloudflare lifecycle bridge with timeouts, bounded retries, schema validation, D1 persistence, idempotency and PII-safe logs. COGS is for internal triage and refund economics only; it must never appear in a customer email.

## State model and source precedence

Use one normalized shipment state per Shopify order and keep every raw observation separately.

| Normalized state | Primary evidence | Customer action |
|---|---|---|
| `PAID` | Shopify paid order | Order assurance only |
| `SUPPLIER_PROCESSING` | matched CJ paid order, no carrier movement | No claim that it shipped |
| `TRACKING_ASSIGNED` | CJ/Shopify tracking number | Show tracking link if safe |
| `CARRIER_PICKED_UP` | carrier/CJ event | Shipping update if Shopify did not send one |
| `IN_TRANSIT` | carrier/CJ event | No routine extra email |
| `DELAYED` | explicit delayed/exception event or deterministic threshold | Proactive service update |
| `OUT_FOR_DELIVERY` | carrier/Shopify event | Usually defer to Shopify/carrier notification |
| `READY_FOR_PICKUP` | explicit pickup event | Pickup notice and one reminder |
| `PICKED_UP` | explicit pickup event | Stop pickup reminders |
| `DELIVERED` | carrier/Shopify delivery event | Delivery acknowledgement and first-use path |
| `BUYER_ACTION_REQUIRED` | carrier/Shopify event | Clear action message |
| `ATTEMPTED_DELIVERY` | carrier/Shopify event | Clear recovery action |
| `RETURNING_TO_SENDER` | carrier/Shopify event | Pause marketing and open support case |
| `SERVICE_CASE_OPEN` | support reply/form/ticket | Pause review, cross-sell and replenishment |
| `REFUNDED` | Shopify financial truth | Stop sales/service reminders for that order |
| `DISPUTED` | Shopify Payments dispute | Internal evidence workflow only |

Source precedence:

1. Shopify is the source of truth for order, payment, refund and final revenue.
2. Carrier events surfaced through Shopify are the preferred delivery truth when timestamped and current.
3. CJ authenticated order data is the supplier/payment/tracking-number source.
4. CJPacket events fill logistics gaps and must retain their source and timestamp.
5. A CJ order-level `DELIVERED` label alone does not overwrite a newer contradictory carrier or Shopify event.

Never infer `DELIVERED` from elapsed time. Never collapse `READY_FOR_PICKUP`, `PICKED_UP` and `DELIVERED` into the same state.

## Lifecycle architecture

```text
Shopify order paid
  -> stop Browse / Cart / Checkout / first-purchase Welcome
  -> order assurance
  -> Shopify + CJ reconciliation
      -> normal movement: stay quiet
      -> missing/stalled/exception: service flow
      -> ready for pickup: pickup flow
      -> delivered/picked up: first-use flow
          -> happy/no issue: review and relevant cross-sell
          -> issue/no parcel: human support; pause promotion
  -> replenishment model based on bundle, usage and prior repurchase
  -> repeat-customer lifecycle

Shopify dispute created
  -> internal-only alert
  -> freeze evidence snapshot
  -> link order, payments, fulfillment, tracking and communication
  -> human decision; no threatening automatic customer email
```

## Revised flow strategy

### 1. Abandoned Checkout — keep 10, remove repetition

The sequence can remain long because intent is high, but each send must solve a different decision problem. Recommended progression: restore order, identify blocker, white-hair proof, use demonstration, bundle economics, concise FAQ, verified proof, policy/support trust, human help, close reminders. Stop immediately on recovery or purchase. A click that declares the blocker should branch to the relevant answer and suppress redundant generic messages.

### 2. Welcome — keep 10, make it a learning path

Progress from fit to use, proof, shade, value and decision help. Stop its first-purchase sales section when the customer enters Cart, Checkout or Purchase. A known existing customer should not be placed back into beginner education.

### 3. Abandoned Cart — keep 5, show the actual choice

Only trigger when an existing, consented identity is matched to the first-party visitor/cart. Include the actual product, shade and bundle. Stop on checkout or purchase. A returning customer receives a short reorder-oriented variant rather than beginner education.

### 4. Browse — keep 3, use strict frequency limits

Only for known, consented identity and meaningful NovaHair product interest. Suggested eligibility: at least two meaningful views or one page engagement threshold, no active Cart/Checkout/Purchase flow, no Browse trigger in the previous 14 days. One helpful message may be enough; Email 2 and 3 require continued interest or an unresolved blocker.

### 5. Post-Purchase — keep nine catalog positions but make two event-driven

- E1: purchase +4 hours, expectation and billing recognition.
- E2: purchase +2 days, preparation and support.
- E3: actual tracking/carrier pickup event, not “Day 7 regardless”.
- E4: only a real delay, no-movement threshold or promise-risk condition, not “Day 14 regardless”.
- E5–E9: anchored to real delivery/pickup confirmation and suppressed while a service case is open.

This fixes the current implementation flaw where E3/E4 are labelled `in_transit` but are scheduled from the purchase timestamp and only suppressed after delivery/ready-for-pickup.

### 6. Replenishment and Winback — split the intent

Do not use “roots returned” as proof that the product is almost empty. Replenishment asks whether enough product remains and allows “remind me in 30 days”. Winback asks whether NovaHair is still relevant and can reduce frequency. Base starting windows may remain 60/105/150 days for 2/4/6 bottles, but should move earlier or later based on self-reported use and real repeat-purchase intervals. The lead time must account for 5–14 business-day delivery.

## New conditional service flows

These are not marketing drip emails. They are sparse, state-triggered service messages. Keep them free of offers and cross-sells.

1. `order.tracking_missing_review` — internal alert after 2 business days without tracking; customer message only after the team or supplier confirms the order is still progressing or a delay exists.
2. `shipment.no_movement` — after 3 business days without a new carrier event; one proactive update, deduplicated by latest event timestamp.
3. `shipment.delayed` — explicit carrier delay or meaningful promise risk.
4. `shipment.ready_for_pickup` — immediate, unless Shopify/carrier already sent an equivalent notification.
5. `shipment.pickup_reminder` — 2–3 days later only if no `PICKED_UP`/`DELIVERED` event.
6. `shipment.buyer_action_required` / `attempted_delivery` — immediate, with the current safe tracking link.
7. `shipment.returning_to_sender` — immediate support case; pause lifecycle marketing.
8. `delivery.confirmation_requested` — one day after delivery: “Did it arrive?” with signed one-click responses.
9. `support.case_opened` — acknowledgement and service SLA; pause promotional email.
10. `refund.processed` — financial confirmation from Shopify, no upsell.

## Decision-help branches

Add four signed one-click choices to selected Welcome, Cart and Checkout messages:

- `blocker=shade`
- `blocker=coverage`
- `blocker=shipping`
- `blocker=price`

The click endpoint records the answer against the lifecycle identity and sends or displays only the matching answer. It must not expose email, customer ID or checkout token in the URL. A random opaque token maps to the private record in D1. Once a blocker is answered, suppress equivalent generic emails for seven days.

## Chargeback prevention data model

Add the following D1 tables or equivalent normalized structures:

### `lifecycle_shipments`

- `shopify_order_id` primary key
- `cj_order_id_hash`
- `tracking_number_hash`
- encrypted tracking URL where needed
- current normalized state and source
- state version
- first/last carrier event timestamps
- tracking-assigned, pickup-ready, picked-up, delivered timestamps
- promised minimum/maximum business-day dates
- latest safe customer-facing status
- last customer update and next review time

### `lifecycle_tracking_events`

Append-only rows keyed by `source + source_event_id`, with normalized state, raw status hash, event time, received time and payload hash. Store no unnecessary address or phone data.

### `lifecycle_service_cases`

Order, reason, state, opened/acknowledged/resolved timestamps, assigned team, customer-contact timestamps and a promotion-pause flag. Do not store message bodies unless required; a secure reference to the support system is preferable.

### `lifecycle_disputes`

Dispute ID, transaction ID, order ID, reason, amount, currency, deadline, status, evidence snapshot ID and human owner. This requires `read_shopify_payments_disputes`. No automatic response submission in v1.

### `lifecycle_evidence_snapshots`

Immutable, access-controlled snapshots containing the order receipt, line items, amount, policy version/hash, descriptor shown by the store, payment transaction IDs, fulfillment timeline, tracking/delivery proof, customer acknowledgements, sent/delivered service messages, replies, refunds and support resolution. Do not expose these in the public analytics endpoint.

## Deterministic rules

- Internal warning: no tracking 2 business days after payment.
- Internal critical review: no tracking 5 business days after payment.
- No movement: 3 business days after the last real carrier event.
- Promise-risk update: from business day 10 if delivery is not imminent.
- Promise breach: after business day 14 unless the stated customer promise was individually revised and recorded.
- Pickup reminder: 2–3 calendar days after `READY_FOR_PICKUP`, once only.
- Delivery acknowledgement: 1 calendar day after `DELIVERED` or `PICKED_UP`.
- Open service case: immediately pause review, cross-sell, winback and replenishment for that order/customer until resolution.
- Refund: stop the order's remaining promotional and operational reminders.
- Dispute: internal-only workflow; do not accuse the customer, threaten police, demand bank withdrawal or imply evidence that does not exist.

Israeli holidays are not yet included in the current business-day calculation. The production definition must either include an explicit holiday calendar or state that operational thresholds use Sunday–Thursday business days while the customer-facing promise remains the approved store policy. Legal review is recommended for the exact boundary between transactional and marketing email in Israel. Operational messages should contain no promotion and no unsubscribe-dependent marketing content.

## Descriptor strategy

The current customer-recognizable name is `NOVAHAIR`. Verify it against a real settled card statement, because the bank can alter display text. Then use one calm line in the purchase assurance message and on the order-status page:

> בפירוט האשראי החיוב יכול להופיע בשם NOVAHAIR.

Do not repeat it in every shipment email. Add the support phone to Shopify Payments if available and make the same brand name prominent on checkout, order confirmation, support pages and the card statement.

## Prevent duplicate notifications

Before enabling each service template, compare it with Shopify's enabled customer notifications. Store a `notification_claim` idempotency record with order, normalized purpose and state version. Example:

`store + order + ready_for_pickup + state_version`

If Shopify already sent the same purpose for that state and the event is observable, suppress Resend. When it is not observable, choose one owner per event in configuration: `SHOPIFY`, `RESEND` or `CARRIER`.

## Analytics that matter

Track by flow, email, SKU/bundle, shipping method and carrier:

- sends, deliveries, unique clicks and unsubscribes;
- support replies or one-click issue reports;
- time from payment to tracking assignment;
- time between carrier events;
- ready-for-pickup to pickup rate;
- delivery acknowledgement rate;
- orders with delay contact before dispute;
- refunds and disputes by reason;
- chargeback rate by transaction count and value;
- net revenue after refunds and disputes;
- estimated saved disputes only when there is a documented customer resolution, never from email attribution alone.

Open rate is diagnostic only because privacy features can inflate it. Revenue attribution should remain three separate views: Resend attribution, first-party lifecycle attribution and Shopify final order/revenue truth.

## Implementation sequence

1. Audit Shopify's currently enabled customer notifications and exact statement descriptor.
2. Add CJ API key to Cloudflare Secrets; never logs, code, D1 plaintext or health output.
3. Add D1 shipment, tracking, service-case, dispute and evidence migrations.
4. Port CJ authentication/order matching/tracking logic into isolated Worker clients with timeouts, retries, rate-limit handling and schema validation.
5. Register `FULFILLMENTS_CREATE`, `FULFILLMENTS_UPDATE`, `FULFILLMENT_EVENTS_CREATE`, `ORDERS_UPDATED`, and—after scope approval—`DISPUTES_CREATE` and `DISPUTES_UPDATE`.
6. Reconcile Shopify and CJ every 30–60 minutes for active shipments, with a 3x/day full risk sweep. Keep the abandoned-checkout 10-minute cron separate.
7. Implement the deterministic rules and append-only event history.
8. Add service-case pause logic to every promotional dispatcher.
9. Add signed response links for “arrived / not arrived / not tried / need help / remind me later”.
10. Create the new templates disabled, then update E3/E4 Post-Purchase scheduling to event-driven triggers.
11. Extend analytics with shipment and dispute views; keep PII behind the authenticated order-detail drill-down.
12. Run the QA matrix below with merchant-controlled test orders before enabling any new customer send.

## QA gates

- CJ API authentication and token refresh work without exposing the API key.
- A CJ paid order matches the correct Shopify order even when one CJ order contains multiple Shopify orders; ambiguous matches are held for review.
- Unsorted carrier events normalize in timestamp order.
- A repeated CJ/Shopify event creates one logical state transition and one notification at most.
- Missing/failed CJ requests create a source-health warning, never a fake shipment status.
- `READY_FOR_PICKUP` triggers a notice; `PICKED_UP` cancels its reminder; Checkout B is not affected by Checkout/Order A.
- `DELIVERED` starts first-use only for the correct order.
- A “did not arrive” click opens a service case and pauses review/cross-sell/replenishment.
- A support reply or issue form pauses promotional lifecycle email.
- A refund stops remaining order messages.
- A dispute webhook creates an internal evidence task and sends no threatening customer email.
- Shopify-native and Resend notification ownership is tested so the customer receives no duplicate shipping message.
- Every customer-facing status is supported by a stored source event and timestamp.
- Descriptor copy matches a real settled statement.
- All links use signed opaque tokens; no email, name, phone, address, tracking number or recovery token appears in UTMs.

## Go-live recommendation

Do not activate the new service/chargeback-prevention sends as one batch. Release in this order:

1. Internal risk alerts and dashboard only.
2. Ready-for-pickup and buyer-action-required, after duplicate-notification audit.
3. Delivery acknowledgement and service-case pause.
4. No-movement/delay messages after two weeks of false-positive review.
5. Event-driven Post-Purchase E3/E4 replacement.
6. Dispute evidence workflow after Shopify scope approval; keep customer contact manual.

Each phase needs a kill switch, per-template enable flag, audit log and rollback procedure.
