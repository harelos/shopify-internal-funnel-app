# NovaHair Lifecycle — Engineering Handoff

Last verified: 2026-09-09

## Outcome

NovaHair's production lifecycle system is live for the four flows that have safe, first-party identity. A real Shopify checkout-to-email-to-purchase end-to-end test passed before the owner's explicit `GO LIVE`. The system remains conservative: purchase is the global stop signal, recovery is correlated by Shopify checkout ID rather than email, every send is rechecked for eligibility, and all provider webhooks are signature-verified and idempotent.

This handoff contains no API keys, bearer tokens, customer email addresses, or recovery URLs.

## Production map

| Component | Production resource |
|---|---|
| Worker | `novahair-lifecycle-bridge` |
| Worker URL | `https://novahair-lifecycle-bridge.tigerbrands-funnel.workers.dev` |
| Current deployment | `46eadc4e-bdc0-488d-ab3d-55038c8b7221` |
| Analytics code deployment | `50603e7e-6fc0-48aa-a464-03fa15e6354c` |
| D1 database | `shopify-funnel-control-db` |
| D1 database ID | `3b3d2e40-28b3-456f-9109-2607fbc51b17` |
| Cron | `*/10 * * * *` |
| Shopify store | `jacobfelipe.myshopify.com` |
| Shopify Admin API | `2026-07` |
| Resend sending domain | `email.tigerbrandsglobal.com` |
| Resend tracking domain | `links.email.tigerbrandsglobal.com` |
| From | `NovaHair by TigerBrandsGlobal <hello@email.tigerbrandsglobal.com>` |
| Reply-To | `support@tigerbrandsglobal.com` |
| Production activation cutoff | `2026-09-08T19:01:36.122Z` |

## Flow state

| Flow | Emails | Resend automation ID | State |
|---|---:|---|---|
| Abandoned Checkout | 10 | `01a0811e-4e70-77a5-ac70-4f4f712e3de6` | enabled |
| Welcome | 10 | `01a0811e-62d3-7129-b4e0-a7c650cff04e` | enabled |
| Abandoned Cart | 5 | `01a0811e-6ee5-733f-8a22-6a30f89b22fa` | disabled — identity gate |
| Browse Abandonment | 3 | `01a0811e-79eb-728e-a789-28ff6180a6e7` | disabled — identity gate |
| Post-Purchase | 7 | `01a0811e-9e6d-77dd-94d1-1de86fbb4a2d` | enabled |
| Replenishment / Winback | 4 | `01a0811e-868c-765e-aa6f-27f727a436ca` | enabled |

The private `GET /api/lifecycle/admin/flows` endpoint is the machine-readable inventory. It returns the approved content and direct Resend links for every automation and template, so the admin application does not need to hard-code 39 records.

## Architecture and ownership

1. Shopify Admin is the source of truth for checkout state, orders, customer consent, currency, and revenue.
2. Signed Shopify `ORDERS_CREATE` and `ORDERS_PAID` webhooks give the fast purchase stop signal. `FULFILLMENTS_CREATE`, `FULFILLMENTS_UPDATE`, and `FULFILLMENT_EVENTS_CREATE` provide order-specific tracking and delivery state. Overlapping Admin API polling protects against missed webhooks.
3. D1 owns durable lifecycle state, exact checkout correlation, outbox/idempotency, send eligibility, scheduling, suppressions, webhook receipts, first-party click attribution, errors, and health state.
4. Resend owns published templates, rendering/delivery, provider suppressions, delivery events, and automation visibility.
5. Signed Resend webhooks feed sent/delivered/opened/clicked/failed/bounced/complained/suppressed state back into D1.
6. The application dashboard reads only the Worker's private, PII-free endpoints. It must not query D1 or Resend directly from the browser.

## Public and private routes

| Route | Purpose | Protection |
|---|---|---|
| `POST /api/lifecycle/webhooks/shopify` | Shopify order webhooks | Shopify HMAC signature |
| `POST /api/lifecycle/webhooks/resend` | Resend delivery webhooks | Svix/Resend signature |
| `GET /api/lifecycle/click/:token` | Single-use first-party attribution redirect | opaque expiring token; no PII in URL |
| `GET /api/lifecycle/health` | operational health and quota | admin bearer token |
| `GET /api/lifecycle/admin/flows` | full flow/email content catalog | admin bearer token |
| `GET /api/lifecycle/admin/analytics` | flow/email performance and revenue | admin bearer token |

Unauthorized admin requests return `404` intentionally. Write-capable admin routes also exist for provisioning and isolated test-mode operations; do not expose them in the product UI.

## Secret bindings

The deployed Worker uses these Cloudflare secrets. Values must remain in Cloudflare's secret store and the corresponding trusted server environment only.

- `SHOPIFY_ACCESS_TOKEN` / protected-data Shopify credential
- `SHOPIFY_WEBHOOK_SECRET`
- `RESEND_API_KEY`
- `RESEND_WEBHOOK_SECRET`
- `LIFECYCLE_ADMIN_TOKEN`
- `LIFECYCLE_DATA_KEY`
- `LIFECYCLE_HASH_KEY`

The dedicated Resend Worker key must never be printed, returned by health, embedded in templates, or committed. Rotate `LIFECYCLE_ADMIN_TOKEN` when connecting a new backend and place the same new value directly into that backend's secret manager. Do not send it through chat or put it in a frontend environment variable.

## Database and migration ownership

- `migrations/0011_novahair_lifecycle.sql` creates lifecycle state, event receipts, delivery events, scheduling, attribution, suppressions, errors, health, resource inventory, contacts, orders, and indexes.
- `migrations/0012_lifecycle_analytics.sql` adds privacy-preserving identity/correlation columns and analytics indexes.
- `migrations/0013_delivery_aware_post_purchase.sql` adds exact-order fulfillment state, privacy-safe tracking hashes, delivery event receipts, and delivery-watch indexes.
- `migrations/0014_cross_sell_eligibility.sql` stores purchased product IDs/handles so a customer is never cross-sold an item already present in that order.

Run migrations before deploying code that depends on them:

```text
npx wrangler d1 migrations apply shopify-funnel-control-db --remote --config wrangler.lifecycle.jsonc
```

Never rewrite an applied migration. Add a numbered migration for every schema change.

## Deployment and verification

```text
npm install
npm test
npm run build
npm run build:worker
npx wrangler deploy --dry-run --config wrangler.lifecycle.jsonc
npx wrangler deploy --config wrangler.lifecycle.jsonc
```

After deployment verify:

1. all tests pass;
2. an unauthenticated admin API request returns `404`;
3. authenticated `health`, `flows`, and `analytics` requests return `200` from a trusted server;
4. `flows` reports 6 flows and 39 emails;
5. production flow states are four enabled and two identity-gated;
6. health has no open errors, dead schedules, or uncertain events;
7. the next Cron records successful Shopify sync and dispatch state.

The 2026-09-08 production verification passed 40/40 automated tests. The live protected analytics endpoints returned `200`, 6 flows, 39 emails, the correct four/two state split, and no customer PII. The same routes returned `404` without the bearer credential. A real routed Post-Purchase smoke event completed and its email was delivered.

## Delivery-aware Post-Purchase

Post-Purchase is not timed from an assumed international delivery date:

- E01: purchase + 4 hours
- E02: purchase + 2 days
- E03: exact Shopify order `DELIVERED` + 1 day
- E04: delivered + 4 days
- E05: delivered + 10 days
- E06: delivered + 14 days
- E07: delivered + 21 days

Every fulfillment observation is correlated by Shopify order ID. Tracking numbers are stored only as hashes. Orders still not marked delivered 23 days after purchase are surfaced by the private health endpoint; no usage/review email is guessed or sent early. E07 selects only an active product absent from the order: Hair Gloss first, then BiotinRoot. Argan is currently Draft and no active Keratin product was found, so neither is offered.

The marketing and operational source of truth is the Google Doc [NOVAHAIR — מוח המותג: עובדות מאומתות, שאלות ותשובות וקופי Lifecycle](https://docs.google.com/document/d/1S7SVpE0FC0wpKZdNQNYIf6RlqGSVt1kkTDwcXfxboRY/edit?usp=drivesdk).

## Safety invariants

- Checkout A can never be cancelled or recovered because Checkout B has the same email address.
- Purchase stops Browse, Cart, Checkout, and first-purchase Welcome sales sends.
- A marketing send is blocked after unsubscribe, complaint, hard bounce, local suppression, ineligible consent, recovery, purchase, or quota stop.
- Recovery URLs are encrypted at rest and never logged or returned by analytics.
- UTMs contain only flow/email labels. They never contain an address, name, phone, Shopify token, or recovery secret.
- Shopify order data is revenue truth. Attributed revenue is observational last-click revenue, not proven incremental lift.
- Browse/Cart remain disabled until the storefront has reliable consented identity. Do not work around this with invasive tracking or checkout JavaScript.
- No plan upgrade, paid queue, card, or pay-as-you-go was enabled.

## Operations

Use the private health endpoint for routine checks. Investigate immediately when any of these changes from healthy: last Shopify sync, last successful Shopify API call, Resend webhook status, errors, dead schedules, uncertain events, quota dispatch, or domain/resource status.

The free-plan alert thresholds are approximately 70 emails/day (warning), 90/day (critical), 2,400/month, and 9,000 automation runs/month. The bridge must stop safely and alert before a provider cap can silently discard work.

For a production incident, prefer disabling dispatch or the affected automation over deleting state. D1 is the recovery ledger. Do not replay an `UNCERTAIN` Resend event blindly because Events do not provide the same documented idempotency contract as email sends.

## Remaining product work

The backend analytics contract is complete; the visual dashboard still needs to be embedded in the internal application. Follow [ANALYTICS-INTEGRATION.md](./ANALYTICS-INTEGRATION.md). The only intentionally unavailable flows are Browse and Cart, pending a consented identity design in the storefront/PostHog integration.
