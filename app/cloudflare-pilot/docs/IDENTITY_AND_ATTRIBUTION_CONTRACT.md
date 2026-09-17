# Identity and attribution contract

This contract defines the evidence chain from a storefront visit to a paid Shopify order.
It is intentionally strict: missing identity remains unattributed rather than guessed.

## Identity graph

```text
anonymous browser key
  -> Visitor (stored as a hash-backed internal row)
  -> deterministic experiment Assignment
  -> cart token + CartElementAttribution
  -> checkout token + CheckoutAttribution
  -> Shopify order GID + OrderAttribution
  -> OrderElementAttribution / popup attribution
```

Customer support has a separate graph:

```text
mailbox message ID
  -> SupportMessage
  -> canonical email inside the protected support database
  -> SupportCustomer
  -> SupportConversation
  -> optional verified Shopify customer/order context
  -> AI decision, draft, send and delivery evidence
```

Email and phone may be used inside the protected support system to find a customer or
order. They must never become analytics `distinct_id`, public event keys, documentation
examples, or owner-facing technical labels.

## Authority by stage

| Stage | Authority | What it may prove |
| --- | --- | --- |
| Visit and engagement | First-party storefront events | A browser performed an action |
| Experiment assignment | Deterministic server allocation | Which variant that anonymous visitor was assigned |
| Cart | Shopify cart token plus persisted assignment context | Which assignment reached a cart |
| Checkout | Shopify Web Pixel checkout token | Which cart/visitor context entered checkout |
| Purchase | Shopify `orders/paid` / reconciled paid order | That money was paid and its Shopify value/currency |
| Refund/update | Shopify `orders/updated` / reconciliation | Net revenue and current order state |

PostHog, Meta, and GA4 are analysis/delivery destinations. None is the financial source
of truth for owner reporting.

## Join and confidence rules

- Exact checkout-token continuity: `HIGH` confidence.
- Explicit verified funnel/variant context without the full chain: record its actual
  lower confidence; do not upgrade it silently.
- Paid order with no surviving browser/checkout identity: `UNATTRIBUTED`.
- Reconciliation may recover a Shopify order but may not invent a visitor, campaign,
  Concierge, popup, or experiment assignment.
- A purchase may appear in Shopify before an analytics destination. Owner reporting uses
  Shopify and labels destination coverage separately.

## Idempotency

- Generic internal events use unique `Event.eventKey`.
- Shopify pixel events use Shopify's source event ID.
- Shopify orders use the unique Shopify order GID; webhook deliveries also keep their
  delivery identity.
- Element exposures use a unique exposure event ID.
- Element purchases use one event ID per order and experiment.
- Support messages use the mailbox Message-ID; outbound AI drafts use a deterministic
  Message-ID derived from the internal draft ID.

## Attribution preservation

- Persist first-touch landing context and current-touch context before leaving the
  storefront.
- Carry UTM/click identifiers through cart and checkout only in approved bounded fields.
- The storefront writes a private `__funnel_context__` cart attribute as a cross-domain
  fallback. It contains only pseudonymous IDs and allow-listed acquisition fields; it
  never changes items, quantities, prices, discounts, or visible checkout content.
- The Web Pixel reduces Shopify's event inside the strict sandbox before sending it. Raw
  checkout data, customer contact details, addresses, line items, and foreign cart
  attributes never cross into the app ingestion request.
- Preserve the anonymous visitor/session key through checkout where Shopify permits it.
- Once a Shopify customer is known, analytics systems may identify using the Shopify
  customer ID. PostHog receives the explicit anonymous-to-Shopify link and retains the
  active session ID. Never use email or phone as analytics identity.
- Later events enrich an identity chain; they do not rewrite earlier truth.

## Test and internal traffic

Events marked internal/test are retained only where useful for QA and excluded from
production reporting. Known QA campaign/path markers are classified as test traffic.
Synthetic order tests must never enter production revenue.

## Failure behavior

- Missing checkout token: store the paid order, label attribution missing.
- Destination failure: keep the authoritative internal record and retry the destination
  separately; do not replay the customer action.
- Duplicate webhook/pixel/email: return an idempotent duplicate result.
- Invalid or ambiguous identity: reject the join and expose the coverage gap.
- Revenue mismatch: compare Shopify order values first, then audit downstream payloads;
  do not edit historical revenue to match an ad platform.
