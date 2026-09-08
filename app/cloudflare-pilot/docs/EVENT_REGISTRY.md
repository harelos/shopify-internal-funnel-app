# Canonical event registry

This registry contains event contracts verified in the current source. It prevents
duplicate semantics, inconsistent names, and revenue claims based on browser signals.

## Common rules

- `event_id` or the internal `eventKey` is stable and unique for one logical action.
- Repeated delivery of the same source event must be idempotent.
- `is_internal` / `isTest` removes QA activity from production reports.
- `visitor_id` is anonymous and must not be an email address or phone number.
- `checkout_token` is the bridge from browser/cart context to checkout and then to an
  authoritative Shopify paid order when Shopify supplies it.
- `order_id` is the Shopify order GID for server-owned purchase events.
- `currency` accompanies every monetary value. No implicit currency conversion is made.

## Funnel and storefront events

The legacy `/api/track` route accepts only these names:

| Event | Meaning | Required identity | Revenue? |
| --- | --- | --- | --- |
| `page_view` / `FUNNEL_PAGE_VIEWED` | Funnel page rendered | Funnel; visitor recommended | No |
| `cta_click` / `FUNNEL_CTA_CLICKED` | Funnel CTA activated | Funnel; visitor recommended | No |
| `checkout_started` / `CHECKOUT_STARTED` | Funnel requested checkout | Checkout token recommended | No |

The application may read these additional customer-journey events when a storefront
instrumentation source sends them: `view_item`, `gallery_image_viewed`,
`gallery_image_clicked`, `section_viewed`, `faq_item_opened`, `testimonial_clicked`,
`add_to_cart_succeeded`, `cart_drawer_opened`, `view_cart`, `checkout_clicked`, and
`begin_checkout`. Their human-readable journey labels already exist. They are not yet
accepted by the legacy `/api/track` allowlist; do not claim complete internal coverage
until the dedicated ingestion path is verified.

## Shopify Web Pixel events

The pixel adapter intentionally accepts only:

| Shopify source event | Internal event | Dedupe key | Use |
| --- | --- | --- | --- |
| `checkout_started` | `CART_CHECKOUT_STARTED` | `shopify:pixel:{pixel_event_id}` | Persist checkout identity/context |
| `checkout_completed` | `CHECKOUT_COMPLETED_OBSERVED` | `shopify:pixel:{pixel_event_id}` | Observe completion; never own revenue |

Unknown pixel events are rejected from funnel reporting. The adapter stores reduced
metadata, not the arbitrary raw browser payload.

## Shopify order events

| Source | Internal record/event | Identity | Commercial role |
| --- | --- | --- | --- |
| `orders/paid` webhook | `SHOPIFY_ORDER_PAID` and `OrderAttribution` | Shopify order GID | Authoritative paid order and revenue |
| `orders/updated` webhook | Updated `OrderAttribution` | Shopify order GID | Authoritative refunds, cancellations, and total changes |
| Scheduled reconciliation | Updated/missing `OrderAttribution` | Shopify order GID | Idempotent recovery; never synthesizes a second purchase event |

## Element experiment events

| Event | Destination | Required properties | Notes |
| --- | --- | --- | --- |
| `experiment_exposed` | D1 exposure ledger and PostHog | experiment, variant, assignment, allocation version, slot, page, event ID | One exposure event ID; internal traffic excluded from PostHog |
| `$feature_flag_called` | PostHog | matching experiment context | Emitted only when a PostHog flag key exists |
| `gallery_image_viewed` | PostHog | experiment context, image ID/index | Initial image and subsequent changes |
| `gallery_thumbnail_clicked` | PostHog | experiment context, image ID/index | Explicit thumbnail action |
| `gallery_swiped` | PostHog | experiment context, image ID/index, direction | Explicit swipe action |
| `gallery_image_engaged` | PostHog | experiment context, image ID/index, duration | At least 500 ms visible before change/hide/page exit |
| `element_purchase_attributed` | PostHog plus D1 paid-order attribution | order ID, checkout token, revenue, currency, experiment assignment | Server-owned; emitted only for a paid, non-test Shopify order |

Experiment winner decisions use the D1 Shopify-paid-order result, not PostHog exposure
counts by themselves.

## On-site experience events

Canonical events shared by Exit Popup and AI Concierge:

- `popup_signal`
- `popup_suppressed`
- `popup_eligible`
- `popup_view`
- `popup_email_started`
- `popup_consent_checked`
- `popup_submit_attempt`
- `popup_submit_success`
- `popup_submit_failed`
- `popup_coupon_revealed`
- `popup_continue_clicked`
- `popup_closed`
- `popup_ai_step`
- `popup_result_email_sent` — server confirmed
- `popup_purchase` — Shopify/server confirmed

`popupVersion` and the `experience`/version convention distinguish Concierge from Exit
Popup. Shopper free text is length-capped and redacted for email, phone, and URLs before
persistence. Server-confirmed success, send, and purchase events cannot be submitted as
ordinary storefront events.

## Support evidence events

The support evidence ledger currently uses:

| Kind | Source | Meaning |
| --- | --- | --- |
| `INBOUND_EMAIL` | Namecheap IMAP | Customer message observed |
| `OUTBOUND_EMAIL` | Namecheap IMAP/SMTP | Reply observed or sent |
| `SEND_AUTHORIZED` | Support policy/admin/API | Records whether automation policy, the owner, or an authenticated agent authorized the send |
| `DRAFT_APPROVED_FOR_SEND` | Support API | Legacy compatibility evidence for agent-approved drafts |
| `OUTBOUND_DELIVERY_VERIFIED` | Namecheap Sent via IMAP | Deterministic Message-ID exists in Sent |
| `OUTBOUND_BOUNCED` | Namecheap delivery-status notification via IMAP | A permanent DSN was matched to the exact deterministic support Message-ID |
| `SHOPIFY_ORDER_SNAPSHOT` | Shopify Admin | Order facts used for an AI decision |
| `ORDER_LOOKUP_FAILED` | Shopify Admin | Order verification failed |
| `AI_DECISION` | AI provider | Decision, confidence, policy result, and draft reference |

Support evidence is hash-chained per conversation. Sent-folder verification proves the
mailbox accepted and stored a Sent copy; it does not prove recipient inbox placement.
A bounce requires an exact `support-draft-*` Message-ID plus an RFC-style permanent
failure signal. Delayed `4.x.x` reports are not treated as bounces, and unmatched DSNs
do not alter a conversation.

## Adding a new event

Before production:

1. Name one owner and one business question.
2. Define the exact logical action and dedupe key.
3. Define required/optional properties and privacy treatment.
4. Define whether it is behavioral, operational, or authoritative financial data.
5. Add ingestion validation, tests, a readable label, and this registry entry.
6. Verify that QA traffic is excluded and rerenders cannot duplicate the event.
