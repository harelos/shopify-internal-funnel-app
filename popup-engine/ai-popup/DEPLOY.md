# NovaHair AI Concierge - Production Runbook

Last verified: 2026-09-06, including Meta in-app browser QA.

## Current deployment

- Primary page: `https://tigerbrandsglobal.com/pages/novahair-sales-staging`
- Live theme ID: `182172320039`
- QA theme ID: `188482584871`
- Production Worker version: `e02cdeb6-c145-4b4f-a80b-842c97878c21`
- App Proxy: `/apps/funnels` ->
  `https://shopify-funnel-control.tigerbrands-funnel.workers.dev/apps/funnels`

Health check:

```text
GET https://tigerbrandsglobal.com/apps/funnels/api/proxy-health
{"ok":true,"service":"novahair-ai-concierge"}
```

## Release order

1. Run `npm test` and `npm run build` in `app/cloudflare-pilot`.
2. Run `popup-engine/ai-popup/harness/verify_core.cjs` and
   `popup-engine/ai-popup/harness/verify_meta_webviews.cjs`.
3. Deploy the Worker before storefront assets when the API contract changes.
4. Upload changed assets to QA theme `188482584871` with `--nodelete`.
5. Verify the real App Proxy response in the QA theme.
6. Upload only reviewed files to live theme `182172320039` with `--nodelete`
   and `--allow-live`.
7. Pull the deployed files back and compare their SHA256 hashes.
8. Run `popup-engine/ai-popup/harness/verify_live_theme.cjs` in a fresh
   browser context with no theme-preview cookie.

Set Shopify CLI attribution before theme commands:

```powershell
$env:SHOPIFY_CLI_AGENT_INFO='n:codex|v:1.0|p:openai'
$env:SHOPIFY_CLI_AGENT_IDS='s:ai-popup-production|r:20260906-finalize|i:codex-desktop'
```

## Theme integration

The snippet is deliberately inert unless `enabled: true` is passed. The live
clean layout currently renders it only for the primary page handle:

```liquid
{%- if page.handle == 'novahair-sales-staging' -%}
  {%- render 'novahair-ai-concierge', enabled: true, placement: 'exit_sales' -%}
{%- endif -%}
```

Do not make the render global. Do not enable it on cart, checkout, account,
order, challenge, or thank-you paths.

## Secrets

`OPENROUTER_API_KEY` is a Worker secret and must never appear in Liquid or a
theme asset. `OPENROUTER_MODEL` is optional; without it the server-owned model
ladder is used. Never print either value in logs or release notes.

## Release gates

- Shopify-signed requests only on storefront AI routes.
- Deterministic commercial facts bypass the model.
- Free text is redacted before persistence.
- Lead success requires Shopify confirmation and consent tags.
- Cart lines and totals remain unchanged throughout the popup flow.
- No request to cart add/change/clear endpoints.
- Legacy static popup remains hidden and uninitialized.
- Mobile and desktop sheets fit inside the viewport.
- Instagram and Facebook WebViews on iOS and Android pass the visual-viewport,
  compact-keyboard, safe-area, touch-target, and no-horizontal-overflow matrix.
- Every explicit flow target resolves to a real node.

## Rollback

- Pre-Meta-WebView popup assets:
  `rollback/ai-popup-meta-webview-20260906/live/assets/`
- Theme layout backup:
  `rollback/ai-popup-20260906/layout/novafunnel-staging-clean.liquid`
- Previous Worker version:
  `b3b2b9d6-63f2-4ec9-bc32-2da10d382717`

Rollback the smallest failing layer first. Theme and Worker can be rolled back
independently.
