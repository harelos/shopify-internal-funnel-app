# NovaHair Lifecycle Email Platform

Production lifecycle email infrastructure for NovaHair, connecting Shopify, Cloudflare Workers/D1, and Resend.

## Current production status

- Live Worker: <https://novahair-lifecycle-bridge.tigerbrands-funnel.workers.dev>
- D1 database: `shopify-funnel-control-db`
- Schedule: every 10 minutes, plus signed Shopify webhooks
- Sending domain: `email.tigerbrandsglobal.com` (verified)
- Enabled flows: Abandoned Checkout, Welcome, Post-Purchase, Replenishment / Winback
- Identity-gated flows: Abandoned Cart and Browse Abandonment remain disabled until the storefront can link a consented subscriber to a first-party session reliably
- Templates: 39 published Resend templates
- Automated verification: 37 tests passing

The complete production proof and resource inventory are in [PRODUCTION-READINESS-REPORT.md](./PRODUCTION-READINESS-REPORT.md).

## Developer handoff

- [HANDOFF.md](./HANDOFF.md) — architecture, live resource map, deployment, operations, and safety rules
- [ANALYTICS-INTEGRATION.md](./ANALYTICS-INTEGRATION.md) — private API contract for the application dashboard, metrics, content inspection, and attribution rules
- [research/open-source-lifecycle-findings.md](./research/open-source-lifecycle-findings.md) — open-source research and the patterns adopted

## Private server API

The Worker exposes three read-only admin endpoints:

- `GET /api/lifecycle/health`
- `GET /api/lifecycle/admin/flows`
- `GET /api/lifecycle/admin/analytics?from=<ISO>&to=<ISO>`

They require `Authorization: Bearer <LIFECYCLE_ADMIN_TOKEN>`. Unauthorized requests intentionally return `404`. The token must be stored only in the application backend; never put it in browser JavaScript, a mobile app, Git, logs, or a public URL.

`/admin/flows` returns the full six-flow / 39-email catalog, including timing, subject, preview, CTA, approved body copy, Resend template ID/link, and automation status/link. `/admin/analytics` returns delivery, open, click, conversion, Shopify revenue, and first-party attribution metrics per flow and per email without customer PII.

## Local verification

Requirements: Node.js 20 or newer and an authenticated Wrangler installation.

```text
npm install
npm test
npm run build
npm run build:worker
npx wrangler deploy --dry-run --config wrangler.lifecycle.jsonc
```

Production secrets are intentionally absent from this repository.
