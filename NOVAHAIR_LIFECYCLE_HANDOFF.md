# NovaHair Lifecycle Email System — Handoff Index

This branch adds the complete, tested NovaHair Shopify → Cloudflare Workers/D1 → Resend lifecycle service and the contract needed to embed its analytics in the internal funnel application.

Start here:

1. [Shopify embedded application handoff](./APP_TEAM_SHOPIFY_EMBEDDING_HANDOFF.md) — give this to the application team first.
2. [Production and engineering handoff](./services/novahair-lifecycle-bridge/HANDOFF.md)
3. [Application analytics integration](./services/novahair-lifecycle-bridge/ANALYTICS-INTEGRATION.md)
4. [Production-readiness proof and all resource IDs](./services/novahair-lifecycle-bridge/PRODUCTION-READINESS-REPORT.md)
5. [Service source and local verification](./services/novahair-lifecycle-bridge/README.md)
6. [Open-source research and architecture decisions](./services/novahair-lifecycle-bridge/research/open-source-lifecycle-findings.md)

The application work is intentionally a backend-to-backend integration. Its server calls the private Worker APIs and exposes the sanitized response only to an authenticated admin. No Shopify, Resend, Cloudflare, or lifecycle admin credential may be shipped to browser JavaScript.

The service is already deployed. This branch does not deploy or enable another copy and contains no production secrets.
