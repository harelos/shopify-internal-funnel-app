# Funnel Control Web Pixel

This extension forwards only `checkout_started` and `checkout_completed` to the
app's public HTTPS ingestion endpoint. It sends a pseudonymous funnel context
when the app-proxy page has set `_funnel_context`. It does not send customer
names, emails, addresses, or raw checkout payloads.

The pixel is observational. Paid revenue is reconciled from signed Shopify
`orders/paid` and `orders/updated` webhooks, not from the browser.
