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

## Local app

The Node/TypeScript app lives in `app/` and is memory-backed until the owner
provisions the approved Railway/PostgreSQL service. It supports local funnel
creation, renaming, ordered steps, HTML import, safe preview, deterministic
assignments, synthetic events, analytics, and CSV/JSON reports.

```powershell
cd app
npm install
npm run dev
```

Open `http://localhost:3000`. The dashboard is visibly marked local-only and
synthetic. The app does not connect to a Shopify store by default.

## Shopify Basic boundary

The app tests pre-checkout pages. Shopify checkout is the measurement boundary,
not an A/B-test surface. Confirmed revenue must come from verified Shopify paid
order events, while observed checkout starts remain a separate metric.

## Railway status

Railway connection work is delegated to Maria Anjelica TBG. No Railway project,
PostgreSQL database, Shopify app, theme, webhook, or production deployment is
claimed by this repository until those resources are owner-provisioned and
verified.
