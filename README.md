# Funnel Control Internal

Private, code-first Shopify funnel control room for one owner/store.

## Preview

The live static example funnel is available at:

https://harelos.github.io/shopify-internal-funnel-app/preview/

Source repository:

https://github.com/harelos/shopify-internal-funnel-app

The local source file is:

`preview/index.html`

It demonstrates:

1. Pre-sell Experiment 1: Advertorial vs. 7 Reasons Listicle.
2. Sales Experiment 2: Story & Proof vs. Offer & Value.
3. Native Shopify checkout handoff.

The static preview is intentionally not connected to Shopify and does not
accept payment. Product, price, delivery, review, and policy fields marked with
brackets are owner-verification placeholders.

## Internal app and lifecycle analytics

The Node/TypeScript app lives in `app/`. The existing Railway production
service hosts the internal control room and the private NovaHair lifecycle
analytics dashboard. It supports local funnel creation, renaming, ordered
steps, HTML import, safe preview, deterministic assignments, synthetic events,
analytics, and CSV/JSON reports.

```powershell
cd app
npm install
npm run dev
```

For production, open the authenticated app host at:

https://funnel-app-production-e22d.up.railway.app/admin/lifecycle-analytics.html

The analytics page reads sanitized flow, email, delivery, click, health, and
Shopify-attribution data through the app's server-side proxy. It never exposes
the Worker token or customer recovery URLs. For local development, open
`http://localhost:3000`; the app does not connect to a Shopify store by
default.

To see the seeded example inside the running software, open:

`http://localhost:3000/preview/`

That route reads the in-memory funnel records created by the Node app. It lets
you switch between the Advertorial/Listicle variants, the Story/Proof and
Offer/Value variants, and the Shopify checkout boundary.

## Shopify Basic boundary

The app tests pre-checkout pages. Shopify checkout is the measurement boundary,
not an A/B-test surface. Confirmed revenue must come from verified Shopify paid
order events, while observed checkout starts remain a separate metric.

## Railway status

The existing Railway `funnel-app` production service is deployed and verified.
The lifecycle analytics dashboard deployment is healthy, and the app's
server-only `LIFECYCLE_WORKER_URL` and `LIFECYCLE_ADMIN_TOKEN` are configured
in Railway secrets/variables. The lifecycle Worker remains the source of truth
for D1, Resend, Shopify lifecycle state, and email attribution.
