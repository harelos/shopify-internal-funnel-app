# Cloudflare port

This directory is the Cloudflare Worker port of the Shopify funnel app. The original
Express/Prisma app remains in the parent directory unchanged.

- Worker: `shopify-funnel-control`
- Database: `shopify-funnel-control-db`
- Shopify changes: no new Shopify mutation in this feature
- Business schema: `migrations/0001_initial.sql` plus `migrations/0002_variant_shopify_source.sql`
- Runtime: Express on Cloudflare Workers with `nodejs_compat`
- Database: Prisma SQLite schema through the D1 adapter

Endpoints:

- `/api/health` confirms the Worker is serving.
- `/api/db-check` confirms the D1 binding is usable.

Do not add Shopify secrets to this directory. The public Worker and D1 are deployed, and
the existing Shopify App Proxy/webhooks remain in place. Web Pixel ingestion is still
disabled intentionally.

## Import a Shopify page into a variant

In the admin funnel editor, click `+ New Variant`, enter a name, and paste a public page
URL from the configured storefront. The app fetches the page, preserves safe inline
styles where possible, removes scripts and iframes through the existing portability
layer, and creates a normal draft variant. The original Shopify page is not modified.

The import endpoint is `POST /api/steps/:stepId/variants/import` with:

```json
{
  "name": "NovaHair 7 Reasons - Imported",
  "sourceUrl": "https://tigerbrandsglobal.com/pages/novahair-7-reasons-staging"
}
```

The allowed storefront host is configured with `SHOPIFY_STOREFRONT_DOMAIN` and
`SHOPIFY_PAGE_IMPORT_ALLOWED_HOSTS`. The import has a 5 MB limit and a 12 second timeout.
