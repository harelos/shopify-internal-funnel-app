# Funnel Control Web Pixel

This extension forwards only `checkout_started` and `checkout_completed` to the
app's fixed, allow-listed public HTTPS ingestion endpoint. The merchant setting
is retained only for compatibility with the existing Shopify pixel record; an
empty or foreign setting cannot disable or redirect the runtime. It sends a
pseudonymous funnel context from `_funnel_context`, with a private
`__funnel_context__` cart attribute as a checkout-domain fallback. The private
attribute changes no line item, quantity, price, discount, or visible checkout
content. The pixel removes customer names, emails, phone numbers, addresses,
line items, and arbitrary checkout attributes before the network request.

The bounded context can include anonymous visitor and PostHog session IDs,
first/current campaign fields, and active experiment assignment. When Shopify
provides a customer ID after purchase, the server merges the anonymous PostHog
identity into that Shopify customer ID; email and phone are never analytics IDs.

The pixel is observational. Paid revenue is reconciled from signed Shopify
`orders/paid` and `orders/updated` webhooks, not from the browser.
