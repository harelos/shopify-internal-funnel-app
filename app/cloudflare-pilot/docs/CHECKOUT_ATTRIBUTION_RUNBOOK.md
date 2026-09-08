# Checkout attribution runbook

Last reviewed: 2026-09-08

## Purpose

Join a NovaHair storefront visit and element assignment to Shopify checkout and then to
the authoritative paid order. Shopify remains the financial source of truth. The Web
Pixel observes checkout identity; it never decides revenue.

## Evidence path

```text
storefront visitor + campaign + experiment assignment
  -> _funnel_context first-party cookie
  -> private __funnel_context__ cart attribute fallback
  -> Shopify checkout_started Web Pixel event + checkout token
  -> CheckoutAttribution / CheckoutElementAttribution
  -> orders/paid webhook or scheduled order reconciliation
  -> verified paid OrderAttribution / OrderElementAttribution
```

## Privacy and safety boundary

- Allowed: anonymous visitor ID, experiment assignment IDs, UTM source/medium/campaign/
  content/term, campaign/ad set/ad IDs, `fbclid`, `gclid`, landing path, referrer host,
  PostHog anonymous distinct/session IDs, checkout token, Shopify order/customer GIDs.
- Forbidden: customer name, email, phone, address, checkout line items, free-form cart
  attributes, or raw Shopify event bodies.
- The browser bundle reduces the event before sending it. The Worker repeats the
  allow-list validation and length caps.
- The private cart attribute is visually hidden and updates no product, quantity, price,
  discount, note, shipping option, or redirect.
- Pixel and destination failures fail open. They must never block checkout.

## Idempotency

- D1 event key: `shopify:pixel:{Shopify event id}`.
- Duplicate pixel delivery returns `duplicate: true` and writes no second event.
- Shopify order revenue remains unique by Shopify order GID.
- PostHog uses the same source event key as `event_id` and `$insert_id`.

## Identity

- Before purchase, PostHog checkout events use the existing anonymous PostHog distinct
  ID and `$session_id` captured on the storefront.
- When `checkout_completed` supplies a Shopify customer GID, the server sends `$identify`
  with `$anon_distinct_id`, then records the checkout completion under the Shopify
  customer GID.
- Email and phone are never permitted as analytics identities.

## QA procedure

1. Build and test both the Worker and Shopify app packages.
2. Release the Worker before the matching Shopify extension version.
3. Open the NovaHair page with `funnel_pixel_qa=1`. Confirm the experiment assignment is
   stable and the gallery does not flash or change variants.
4. Use Shopify Pixel Helper or a development checkout. Never create a synthetic paid
   production order.
5. Confirm one test `checkout_started` event with the exact Shopify event ID, checkout
   token, visitor, assignment, and `isTest=true`.
6. Confirm QA events are absent from production PostHog reporting.
7. For the next real consenting purchase, confirm the paid order joins by checkout token,
   then verify the experiment result counts one order and Shopify-native revenue once.
8. If the pixel is silent, inspect consent eligibility and the active Shopify app version
   before reconnecting or deleting the pixel record.

## Rollback

- Release the preceding Shopify app version to roll back the extension.
- Roll back the Worker commit independently. The signed Shopify paid-order webhooks and
  scheduled reconciliation continue to preserve revenue truth even while pixel
  attribution is unavailable.
- Do not delete the existing pixel connection or rewrite historical attribution to hide
  a coverage gap.
