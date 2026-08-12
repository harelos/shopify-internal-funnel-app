# Funnel Control — local Phase 2 slice

This is a local-only TypeScript/Node scaffold for the private Shopify funnel app. It is intentionally not connected to Shopify: do not run Shopify CLI linking, create a Dev Dashboard app, add credentials, alter a theme, or deploy from this slice.

## What works locally

- Create/read/archive funnels and add ordered pre-checkout steps through the local dashboard/API.
- Import complete HTML into a draft version, receive a portability report, and preview the normalized result inside a script-disabled sandbox.
- Create deterministic two-variant experiments with basis-point allocation and persistent visitor assignment.
- Ingest synthetic step entry, CTA, checkout-start, and paid-order events with event-key and order-level idempotency.
- Attribute a synthetic paid order only through a known checkout token.
- Aggregate only `TEST` events into unique-entry, CTA, observed-checkout, paid-order, revenue, AOV, and unattributed-order metrics.
- Export the local report as CSV or JSON, with definitions and attribution caveats included in the payload.
- Validate future Shopify Web Pixel checkout signals and `orders/paid` webhooks through pure, offline adapters; these do not connect to Shopify.

## Run

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

Open `http://localhost:3000`. The runtime is memory-backed and resets when it stops. `prisma/schema.prisma` is the PostgreSQL production model; this phase does not create or connect a database.

## Verify

```powershell
npm run build
npm run db:validate
npm run db:generate
npm test
```

## Shopify boundary

`shopify.app.toml` and the official `@shopify/shopify-app-react-router` package establish the future custom-distribution embedded-app boundary. They are deliberately dormant until the owner authorizes a Dev Dashboard app and development-store connection. Shopify Basic checkout remains a native measurement boundary, never a checkout A/B-test surface.

## Phase 4 boundary preparation

`src/shopify-integration.ts` contains no-network adapters for:

- `checkout_started` and `checkout_completed` Web Pixel events;
- HMAC-, topic-, and allowlist-validated `orders/paid` webhook payloads;
- reduced event metadata that excludes arbitrary raw Shopify payloads and customer fields.

Run `npm test` to exercise these adapters with fixtures. The connected receiver,
PostgreSQL persistence, Web Pixel registration, and Shopify authentication remain
owner-gated and are not part of this local slice. See the root-level
`PHASE_4_SHOPIFY_BOUNDARY_SPEC.md` for the exact next inputs.
