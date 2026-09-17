# Shopify System Backup Certification

Date: 2026-09-08

## Scope

This certification covers the custom source code, configuration templates,
tests, deployment documentation, and rollback assets developed for the NovaHair
Shopify funnel. It does not claim to back up Shopify-managed orders, customers,
payments, app databases, Cloudflare D1 data, Railway environment variables, or
third-party SaaS state.

## Repositories and restore sources

Main application repository:

- Repository: `harelos/shopify-internal-funnel-app`
- Branch: `feat/railway-deploy-step1`
- Restore source: the certification commit containing this document

Shopify theme repository:

- Repository: `harelos/tigerbrandsglobal-shopify-theme`
- Baseline/popup analytics branch: `feat/popup-analytics-20260824`
- Verified remote commit: `9d90cfc`
- Side-cart performance branch: `codex/novahair-sidecart-speed-20260829`
- Verified remote commit: `d844c10`

## Covered components

- Cloudflare Worker, migrations, Admin dashboard source, tests, and deployment
  configuration under `app/cloudflare-pilot/`
- NovaHair Concierge theme assets, fixed copy, harnesses, deployment runbook,
  and sanitized developer handoff under `popup-engine/ai-popup/`
- Shopify Cart Transform Function source and tests under
  `app/extensions/novahair-bundle-expand/`
- Railway CJ synchronization worker, lifecycle tagging logic, and tests under
  `cj-sync-worker/`
- Namecheap SMTP OTP relay source and Railway configuration under
  `ops/novahair-email-service/`
- USD-to-ILS migration source and operator documentation under
  `ops/store-currency-ils/`
- Shopify Orders app configuration under `orders-app/`
- Shopify OAuth callback helper source under `oauth-helper/`
- Private Email MCP connector source under `ops/private-email-mcp/`
- AI popup, trigger-control, and side-cart rollback assets under `rollback/`
- Curated cart snapshots and deployment backups under the checked-in backup
  directories in `app/`
- OpenRouter setup documentation under
  `docs/OPENROUTER_FREE_API_DEVELOPER_GUIDE.md`

## Intentionally excluded

- API keys, access tokens, SMTP passwords, Worker secrets, and `.env` files
- CJ token caches and recipient supplements
- Customer/order exports and raw Shopify currency-migration backups
- Cloudflare `.wrangler` state, generated bundles, dependencies, caches, logs,
  screenshots, and local QA output
- Nested Git worktrees and full local theme mirrors

These exclusions are deliberate. Secrets must be restored from the approved
secret manager. Operational data must be restored from each platform's own
encrypted backup/export process.

## Restore order

1. Clone both repositories and check out the branches and commits above.
2. Restore secrets into Cloudflare, Railway, Shopify, and OpenRouter without
   placing them in files tracked by Git.
3. Apply Cloudflare D1 migrations in numeric order and deploy the Worker.
4. Deploy the required theme assets/snippets using the popup and side-cart
   runbooks; preserve the corresponding rollback snapshot.
5. Deploy or verify the Shopify app/function configuration in a development
   store before production.
6. Configure Railway services, then run unit, build, storefront, cart, mobile,
   and end-to-end order QA before enabling production automation.

## Certification conditions

Certification is valid only after the following checks pass on the certification
commit:

- all covered paths exist on the remote branch;
- staged content contains no known credential pattern or excluded data file;
- Worker and Cart Transform unit tests pass;
- Worker TypeScript build passes;
- CJ lifecycle tests pass;
- both theme restore branches are clean and present on their remote.

Live-theme byte-for-byte parity is a separate operational check because Shopify
can be edited outside Git. A fresh Shopify theme pull must be compared with the
restore branch before claiming exact parity with the store at a later date.
