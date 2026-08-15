# Funnel Control — local Phase 2 slice

This is a TypeScript/Node private Shopify funnel app. The local panel and funnel database work without Shopify. The Shopify connection is deliberately disabled until rotated credentials and a public HTTPS host are configured.

## What works locally

- Create/read/archive funnels and add ordered pre-checkout steps through the local dashboard/API.
- Import complete HTML into a draft version, receive a portability report, and preview the normalized result inside a script-disabled sandbox.
- Create deterministic two-variant experiments with basis-point allocation and persistent visitor assignment.
- Ingest synthetic step entry, CTA, checkout-start, and paid-order events with event-key and order-level idempotency.
- Attribute a synthetic paid order only through a known checkout token.
- Aggregate only `TEST` events into unique-entry, CTA, observed-checkout, paid-order, revenue, AOV, and unattributed-order metrics.
- Export the local report as CSV or JSON, with definitions and attribution caveats included in the payload.
- Validate future Shopify Web Pixel checkout signals and `orders/paid` webhooks through pure, offline adapters; these do not connect to Shopify.

## Run locally

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

Open `http://localhost:3000/admin/`. The current local runtime uses the checked-in SQLite database at `prisma/dev.db`, so local funnels persist across restarts. Demo seeding is opt-in with `ENABLE_DEMO_SEED=true`; hosted startup never deletes or seeds owner data.

## Verify

```powershell
npm run build
npm run db:validate
npm run db:generate
npm test
```

## Why the installed Private/Admin app does not work embedded

Shopify has different app distribution types. An app created from Shopify Admin as an Admin-created custom/private app cannot use App Bridge or render embedded inside Shopify Admin. That is the direct platform mismatch behind the current failure. The repository was previously configured with `embedded = true`, an HTTP localhost URL, and a legacy OAuth route, which cannot make that app type embedded.

For an in-Admin panel, create a **Custom Distribution** app in the Shopify Dev Dashboard for the one store, then set its public HTTPS App URL and App Proxy URL. The current `shopify.app.toml` contains placeholders for those values and uses Shopify-managed installation. The browser uses App Bridge session tokens; the server verifies them and performs token exchange. Admin API tokens are never placed in HTML or written into `.env` by the app.

For a true Admin-created app, the fallback is a standalone panel opened from Shopify, using a server-only `SHOPIFY_ACCESS_TOKEN`. It cannot be embedded, and the old `/auth` OAuth route is intentionally disabled.

## Required hosted variables, names only

```text
APP_URL
SHOP_DOMAIN
SHOPIFY_DISTRIBUTION=custom
SHOPIFY_CLIENT_ID
SHOPIFY_CLIENT_SECRET
SHOPIFY_API_VERSION
SHOPIFY_SCOPES
SHOPIFY_LIVE_CONNECT=true
SHOPIFY_REQUIRE_AUTH=true
SHOPIFY_APP_PROXY_URL
SHOPIFY_APP_PROXY_PATH=/apps/funnels
DATABASE_URL
```

`SHOPIFY_ACCESS_TOKEN` is only needed for the non-embedded Admin-created fallback. A Custom Distribution embedded app obtains an online Admin API token by exchanging the verified App Bridge session token. Every Shopify secret must be set in the host secret manager, never committed and never copied from the exposed handoff.

## Connection checks

```text
GET /api/shopify/status
GET /api/shopify/store
```

The first check is configuration-only and never calls Shopify. The second is a read-only store probe. It is disabled unless `SHOPIFY_LIVE_CONNECT=true`; in embedded mode it uses the current request's verified session token and token exchange.

## Shopify boundary

`shopify.app.toml` establishes the custom-distribution embedded-app boundary. The App Proxy is configured as `/apps/funnels` once deployed, and storefront tracking uses the signed App Proxy request path. Shopify Basic checkout remains a native measurement boundary, never a checkout A/B-test surface.

## Phase 4 boundary preparation

`src/shopify-integration.ts` contains no-network adapters for:

- `checkout_started` and `checkout_completed` Web Pixel events;
- HMAC-, topic-, and allowlist-validated `orders/paid` webhook payloads;
- reduced event metadata that excludes arbitrary raw Shopify payloads and customer fields.

Run `npm test` to exercise the local Shopify configuration contract. The connected receiver,
PostgreSQL persistence, Web Pixel registration, and Shopify authentication remain
owner-gated and are not part of this local slice. See the root-level
`PHASE_4_SHOPIFY_BOUNDARY_SPEC.md` for the exact next inputs.
