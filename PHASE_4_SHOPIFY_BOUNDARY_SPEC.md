# Phase 4 — Shopify boundary contract

Status: local-only preparation; no Shopify connection is active.

This phase adds pure adapters for the two future production inputs that Phase 3
needs: Shopify Web Pixel checkout signals and a verified `orders/paid` webhook.
The adapters do not initialize Shopify authentication, call the Admin API, write
to a theme, register a pixel, or ingest into the local synthetic store.

## Contract

- `checkout_started` becomes an observed `CART_CHECKOUT_STARTED` event.
- `checkout_completed` becomes a separate `CHECKOUT_COMPLETED_OBSERVED` signal.
- `page_viewed` is not treated as a funnel metric by this platform adapter;
  funnel page views remain app-proxy client events with explicit funnel context.
- `orders/paid` is accepted only after raw-body HMAC validation, exact topic
  validation, and the configured shop-domain allowlist check.
- Order attribution uses the Shopify order GID, checkout token when present,
  currency, and the selected paid amount. Customer email and arbitrary raw
  payload fields are not returned by the adapter.
- Pixel and webhook event keys are deterministic, so the future persistence
  layer can apply the existing event/order idempotency rules.

## Still deliberately absent

- Shopify Dev Dashboard app credentials and installation.
- A development store and approved `ALLOWED_SHOP_DOMAIN` value.
- Web Pixel extension registration and Customer Privacy API integration.
- Webhook registration and a production persistence adapter.
- Admin GraphQL order reconciliation and refund/cancellation handling.

## Owner-gated next step

Provide or create a development store and custom-distribution app, then configure
the values only in the host environment (never source control):

```text
SHOPIFY_API_KEY
SHOPIFY_API_SECRET
SHOPIFY_APP_URL
ALLOWED_SHOP_DOMAIN
DATABASE_URL
SHOPIFY_WEBHOOK_SECRET
```

The smallest connected implementation after that gate is a development-only
`orders/paid` receiver backed by the PostgreSQL event tables, followed by a
scoped Web Pixel extension. Shopify Basic checkout remains a measurement
boundary; checkout itself is not an experiment target.
