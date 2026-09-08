# NovaHair AI Concierge Popup

Production status: **live on the primary NovaHair sales page** as of
2026-09-06.

- Storefront: `https://tigerbrandsglobal.com/pages/novahair-sales-staging`
- Scope: only `page.handle == 'novahair-sales-staging'`
- Live theme: `182172320039` (`Updated copy of Dawn`)
- Worker: `shopify-funnel-control.tigerbrands-funnel.workers.dev`
- App Proxy health: `/apps/funnels/api/proxy-health`

Despite the URL suffix, `novahair-sales-staging` is the owner's primary live
sales page. Do not treat it as a disposable staging page.

## What is live

- Behaviour-gated exit intent on desktop and mobile.
- Dynamic visual-viewport handling for Instagram and Facebook browsers on
  iOS and Android, including keyboard resize and safe-area padding.
- Hard suppression when the cart has items or checkout intent is detected.
- Hebrew RTL concierge with sales, shade, price, retention, VIP, and service
  paths.
- Free-text answers through a Shopify-signed App Proxy to OpenRouter.
- Server-owned deterministic answers for commercial facts such as shipping.
- Local keyword routing when the model is unavailable or rate-limited.
- Five-shade manual selection and local, on-device photo colour matching.
- Shopify-native lead capture with explicit marketing consent and server-side
  confirmation before a lead is counted.
- Step, decision, and attribution analytics through `/apps/funnels/api/track`.
- Conditional `NOVA10` reveal only for a price objection on a graceful-exit
  path; the code is not handed out to shoppers already ready to buy.

The photo never leaves the shopper's browser. The matcher is a preliminary
colour heuristic, not a medical tool or a guaranteed shade result, and manual
selection always remains available.

## Cart safety

The concierge never adds, removes, duplicates, or changes cart lines. Its only
optional cart write is attribution through `/cart/update.js`, joined to the
shared `window.novaFunnelEnqueueCartMutation` queue. It does not call
`/cart/add.js`, `/cart/change.js`, or `/cart/clear.js`.

## Main files

| File | Role |
|---|---|
| `assets/novahair-ai-flows.js` | Hebrew copy and stable conversation graph |
| `assets/novahair-ai-popup.js` | Accessible UI, routing, capture, and local photo matching |
| `assets/novahair-ai-attribution.js` | Conversion attribution and serialized cart attributes |
| `assets/novahair-ai-facts.js` | Approved commercial facts |
| `assets/novahair-ai-agents.js` | Sales, retention, VIP, and service lane selection |
| `assets/novahair-ai-tone.js` | Client-side response cleanup |
| `theme/novahair-ai-concierge.liquid` | Opt-in Shopify integration |
| `../../app/cloudflare-pilot/src/routes/ai-concierge.ts` | Signed AI and admin routes |
| `harness/verify_live_theme.cjs` | Fresh-context production smoke test |

Step IDs are analytics keys. Do not rename existing IDs; add new nodes when a
flow needs to evolve.

## Verification

Run from the repository root. Set `PLAYWRIGHT_PATH` when using Codex's bundled
Playwright package.

```powershell
cd app/cloudflare-pilot
npm test
npm run build

cd ../..
node popup-engine/ai-popup/harness/verify_core.cjs
node popup-engine/ai-popup/harness/verify_meta_webviews.cjs
node popup-engine/ai-popup/harness/verify_photo_match.cjs
node popup-engine/ai-popup/harness/verify_live_theme.cjs
```

To regression-test a real portrait without storing the shopper image in the
repository, pass its local path and expected shade key:

```powershell
node popup-engine/ai-popup/harness/verify_photo_match.cjs C:\path\portrait.png dark_brown
```

The photo test exercises the upload UI, all five approved shade references,
the supplied portrait, and asserts that the flow sends no cart-line mutation.

The live smoke test validates mobile and desktop rendering, all five shade
assets, automatic exit intent, cart suppression, an unchanged real cart,
zero cart-line mutation requests, no popup runtime errors, and that the old
static popup remains inactive.

The Meta WebView matrix covers Instagram and Facebook user agents on iOS and
Android. It checks dynamic visual-viewport resizing, compact keyboard height,
safe positioning, horizontal overflow, 44px close targets, 16px form inputs,
scroll locking, and scroll restoration on close.

## Operational notes

- `NOVA10` is active in Shopify: 10%, one use per customer, limited to the
  segment `Customers who haven't purchased`.
- The legacy popup HTML remains inside the page's stored body, but its runtime
  asset is not loaded by the live clean layout. Production QA asserts that it
  stays hidden and uninitialized when the AI popup fires.
- Rate limiting is per Worker isolate. Move the counter to D1 if traffic or
  abuse makes a global limit necessary.
- The admin step query is bounded to 20,000 events. Add pagination before that
  becomes an operational limit.

## Rollback

The exact pre-release live layout is stored at:

`rollback/ai-popup-20260906/layout/novafunnel-staging-clean.liquid`

The previously deployed Worker version is
`b3b2b9d6-63f2-4ec9-bc32-2da10d382717`.
