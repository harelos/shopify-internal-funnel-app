# TIGER Bot Control Dashboard

Date: 2026-08-24
Branch: `feat/tiger-profit-os-platform-v1`
PR: #1
Release state: private staging/admin only

## Scope implemented

This slice adds an operator dashboard for the existing TIGER bot platform without enabling any storefront runtime.

### Dashboard

New private admin page:

- `app/admin/bot-dashboard.html`
- `app/admin/css/bot-dashboard.css`
- `app/admin/js/bot-dashboard.js`

The dashboard shows:

- Storefront OFF / private staging state
- conversation count
- knowledge-pack count
- model allocation
- provider health and model-pricing status
- exact four-level bot truth hierarchy
- restricted facts and never-expose categories
- visual bot brain map
- offer ladder and economics-gate state
- model experiment performance
- role/tool permission matrix
- CRM fact-vs-inference provenance rules
- explicit implementation/staging/production state separation

It reads existing private APIs only:

- `GET /api/bot/config`
- `GET /api/bot/providers/status`
- `GET /api/bot/knowledge`
- `GET /api/bot/analytics?range=7d`

The dashboard does not add customer-facing tool permissions and does not inject any storefront code.

## Truth hierarchy contract

New server-side contract:

- `app/src/lib/bot-truth.ts`

Authority order is fixed:

1. Structured Shopify/store facts
2. Versioned internal knowledge packs
3. Deterministic business rules
4. Model-generated prose

Same-authority conflicts return `UNCERTAIN` instead of selecting a value.

Restricted facts cannot be exposed when their only source is model prose. Internal economics and secrets are never customer-exposable.

The bot system prompt was also updated so the customer-facing model receives this authority order explicitly and must fail closed on missing/conflicting restricted facts.

## Tests

Added:

- `app/test/bot-truth.test.ts`
- `app/test/bot-dashboard-ui.test.ts`

The main `npm test` command now includes both tests.

CI also now:

- syntax-checks `admin/js/bot-dashboard.js`
- renders Bot Studio on mobile/desktop
- renders Bot Control on mobile/desktop
- uploads all four screenshots as the `tiger-bot-ui-renders` artifact

## Navigation

`app/admin/index.html` now exposes separate links for:

- Bot Control
- Bot Studio

This keeps operations/monitoring separate from configuration/editing.

## Not implemented in this slice

This slice does not claim:

- storefront bot launch
- production verification
- automatic coupon creation
- Shopify write access beyond existing approved paths
- full structured extraction of every product/policy fact into the truth resolver
- production Cloudflare/Worker source parity
- secret rotation/history cleanup completion

## QA state

Code implemented: YES
Automated CI: triggered by branch pushes, final result must be checked before calling staging verified
Staging verified: NO, not yet claimed by this handoff
Production verified: NO

## Rollback

The dashboard is additive. Rollback is limited to reverting the dashboard files, navigation link, prompt truth block, truth contract/tests, and CI additions. No storefront code was touched.

## Next recommended bot-platform slice

1. Feed structured Shopify/store facts through the truth resolver before prompt construction.
2. Add explicit source/version metadata to knowledge facts that can affect restricted claims.
3. Add operator drill-down for one conversation: route, model assignment, tool calls, CRM facts, provenance and outcomes.
4. Add server-side offer history / frequency gates before any real coupon issuance.
5. Keep storefront OFF until staging QA and explicit owner approval.
