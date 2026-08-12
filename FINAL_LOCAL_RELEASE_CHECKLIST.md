# Final local release checklist

Status: local implementation complete; external Shopify connection is intentionally pending.

## Completed locally

- Original owner dashboard and workflow wireframe from Phases 0–1.
- Funnel, ordered pre-checkout steps, variants, immutable content versions,
  publication/archive lifecycle, rollback-safe pointers, and portability findings.
- Script-disabled local preview for imported HTML, with review findings for
  scripts, iframes, forms, inline handlers, and JavaScript URLs.
- Stable persisted variant assignment using allocation basis points and an
  allocation-versioned hash.
- Idempotent synthetic event ingestion and checkout-token order attribution.
- Report aggregation and CSV/JSON export with TEST/LIVE separation, date,
  source, UTM, device, step, and variant filters; observed checkout is kept
  separate from confirmed paid revenue.
- Pure Shopify adapters for checkout pixel signals and verified `orders/paid`
  webhooks. They reduce raw payloads to the minimum attribution fields.
- Guarded local HTTP routes for those adapters. They return `403` unless
  `ENABLE_LOCAL_SHOPIFY_ADAPTERS=true`, and webhook requests still require HMAC,
  topic, and shop-domain validation.
- Prisma/PostgreSQL production schema validation. No database connection or
  migration has been run.

## Deliberately not claimed

- No Shopify Dev Dashboard app exists or is linked here.
- No development store is connected.
- No Web Pixel extension is registered.
- No webhook is registered with Shopify.
- No PostgreSQL persistence is active; the local runtime is memory-backed.
- No theme, App Proxy, Admin API, order reconciliation, refund handling, or
  deployment has been exercised against Shopify.

## Final owner-gated inputs

Create/identify the development store and custom-distribution app, then place
these values in the host environment only:

```text
SHOPIFY_API_KEY
SHOPIFY_API_SECRET
SHOPIFY_APP_URL
ALLOWED_SHOP_DOMAIN
DATABASE_URL
SHOPIFY_WEBHOOK_SECRET
```

After that, the smallest connected milestone is: run an app-auth check against
the development store, apply the reviewed PostgreSQL migration, register only
`orders/paid`, and replay a Shopify-provided fixture through the adapter before
adding the Web Pixel extension. Shopify Basic checkout remains a measurement
boundary, not an A/B-test surface.
