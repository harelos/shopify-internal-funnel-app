# CTO QA Baseline — 2026-08-23

Branch: `feat/tiger-profit-os-platform-v1`

This review is intentionally conservative. The branch must not be deployed or merged until the current Cloudflare Worker/D1 production source is synchronized back into Git and the critical gates below pass.

## Scope reviewed

- Express server and route mounting
- Shopify embedded-admin session verification
- Shopify webhook ingestion and HMAC verification
- Funnel analytics route and admin UI
- Funnel storefront renderer / tracking injection
- Prisma schema
- Meta analysis scripts committed to the repository
- New Profit OS reference package and UI scaffold
- New Bot and Popup module scaffolds

## P0 — security / source-of-truth blockers

### P0.1 Repository contains a committed Meta access token
At least two Meta helper scripts contain an access token directly in source. Treat that credential as exposed. It must be revoked/rotated outside this branch. Removing it from one new commit is not sufficient because the value exists in Git history.

Required before production work:
- rotate/revoke the exposed Meta token
- remove hardcoded credentials from tracked scripts
- move future secrets to server-side secret storage only
- consider Git history cleanup if the repository will remain accessible

### P0.2 Git `master` is older than the current Cloudflare production runtime
The deployed Cloudflare Worker/D1 NovaHair monitoring work described in the current operational handoff is not present in this Git `master` tree. Therefore this branch is staging/reference only until deployed source is synchronized back into Git and compared.

Required gate:
- export/sync the exact deployed Worker/D1 source
- compare config, migrations, routes and secrets bindings
- prove the Git revision matches the deployed runtime before integrating Profit OS

## P1 — correctness issues to fix during integration

### P1.1 Partial refunds need canonical Shopify financial truth
Current webhook normalization can collapse refunded/cancelled orders too aggressively. Profit OS must calculate contribution revenue from current Shopify financial fields and explicit refund state rather than assuming every refund means zero revenue.

### P1.2 Embedded admin API client needs a fresh Shopify session token per request
The backend verifies Shopify session tokens, but the current generic browser API helper performs plain `fetch()` calls. Hosted mode needs an App Bridge token on protected API requests and must handle 401/session refresh cleanly.

### P1.3 Payment fees must be nullable when unavailable
Do not treat missing transaction fees as zero. Any dependent CM1/CM2 metric must remain incomplete when authoritative fees are unavailable.

### P1.4 Meta ingestion must avoid semantic duplicate purchase counting
Meta can return multiple action aliases for the same purchase. The ingestion layer must use an explicit precedence/mapping policy instead of summing synonymous purchase action types.

### P1.5 Meta backfill cursor should be per ad account
A single global last-success date can hide gaps when one ad account fails and another succeeds. Production design should persist sync state per account/date range.

### P1.6 Shopify GraphQL must implement bounded retry/throttle handling
Production code must handle HTTP 429/5xx and GraphQL throttling/errors with bounded exponential backoff + jitter and no unbounded retry loops.

### P1.7 CJ + order-profit updates should be atomic where possible
D1 writes that update the CJ ledger and derived order-profit row should use a transaction/batch so a process interruption cannot leave half-applied financial state.

## New module separation decision

- Detailed Funnel Analytics stays inside funnel context.
- Profit OS is a separate global analytics module.
- Bot gets its own Builder + Analytics tabs.
- Popups get their own Builder + Analytics tabs.
- Profit OS may summarize funnel performance, but must not absorb detailed step/drop-off analysis.

## New branch QA performed

- New admin JS syntax checks: PASS
  - `profit-analytics.js`
  - `bot.js`
  - `popups.js`
- Existing TIGER Profit OS isolated reference package:
  - TypeScript strict build: PASS
  - Unit tests: 14/14 PASS
  - CJ unpaid vs paid truth classification: PASS
  - CJ actual-payment residual charge handling: PASS
  - Meta missing-day backfill helper: PASS
  - AES-GCM token-vault round trip: PASS
  - Contribution revenue formula tests: PASS
  - CM0 / CM1 tests: PASS
  - Aggregate CM2 subtracts all Meta spend: PASS
  - Recommendation rule tests: PASS

## Not yet claimed

The following are not yet claimed as passing because the currently deployed Cloudflare source is not in this Git branch:

- live Shopify → D1 order ingestion for Profit OS
- live CJ → Profit OS scheduled cost sync
- real BOI FX fetch/backfill
- production Meta token validation + encrypted D1 persistence
- production Profit OS API routes
- browser E2E in embedded Shopify Admin
- live Bot storefront runtime
- live Popup storefront runtime

No storefront code has been deployed from this branch.
