# Funnel Control Web Pixel

This extension forwards only `checkout_started` and `checkout_completed` to the
app's fixed, allow-listed public HTTPS ingestion endpoint. The merchant setting
is retained only for compatibility with the existing Shopify pixel record; an
empty or foreign setting cannot disable or redirect the runtime. It sends a pseudonymous funnel context
when the app-proxy page has set `_funnel_context`. It does not send customer
names, emails, addresses, or raw checkout payloads.

The pixel is observational. Paid revenue is reconciled from signed Shopify
`orders/paid` and `orders/updated` webhooks, not from the browser.
