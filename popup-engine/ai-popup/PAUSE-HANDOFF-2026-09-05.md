# NovaHair AI Concierge - Pause handoff

**Paused:** 2026-09-05
**Reason:** The owner asked to switch to another task before the final DEV-store integration.
**Live storefront status:** Unchanged. Nothing was installed in the live theme, no Shopify app configuration was deployed, and no Worker version was promoted to production traffic.

## Non-negotiable scope

- `novahair-sales-staging` is the main NovaHair sales page despite its name. Do not use it for experiments and do not inject the concierge there yet.
- Continue QA on the isolated Cloudflare Preview and then on an unpublished theme in `novahair-dev.myshopify.com`.
- Do not run `shopify app deploy` from the parent `app` directory. That directory also discovers unrelated fulfillment/pixel extensions.
- Do not run `wrangler versions deploy` or `wrangler deploy` until the complete edge and unpublished-theme checks pass.

## What is complete locally

- AI concierge frontend, Hebrew flows, factual grounding, attribution, consent-aware lead capture, and authenticated analytics dashboard.
- Server-owned AI instructions; shopper requests cannot override the goal or style.
- Timeouts, input sanitization, PII redaction, rate limiting, accessibility/focus handling, and browser-only photo analysis wording.
- Cart attribution is serialized through the shared cart mutation queue, so this feature does not add another cart race.
- Shopify lead success is accepted only after backend confirmation and the required one-time tag.
- Signed Shopify App Proxy verification is implemented in:
  - `app/cloudflare-pilot/src/lib/shopify-app-proxy-auth.ts`
  - `app/cloudflare-pilot/src/middleware/shopify-auth.ts`
- Explicit storefront endpoints are limited to `/track`, `/popup/confirm-lead`, `/ai-chat`, and `/proxy-health`.
- Explicit `/apps/funnels/api` routes now mount before the generic funnel proxy route in `app/cloudflare-pilot/src/server.ts`. This fixed the earlier false 404.
- Shipping source-of-truth now says delivery to any point in Israel, 5-12 business days. It no longer promises home delivery.

## Identity and infrastructure confirmed

- Shopify app: `Funnel Builder`
- Client ID: `336aed7a0572b8179610ed2e5698cd78`
- Local linked config: `app/shopify.app.funnel-control.toml`
- The app client ID matches both `app/.env` and the Worker dashboard injection.
- This is not the `NovaHair Fulfillment` app. Do not modify that app for this feature.
- Cloudflare Worker: `shopify-funnel-control`
- Isolated Preview alias:
  `https://novahair-ai-qa-shopify-funnel-control.tigerbrands-funnel.workers.dev`
- Last uploaded diagnostic Preview version:
  `968dcb10-5dda-4d34-bfd4-372f71a53b70`
- The OpenRouter and Shopify app secrets were available to the Preview without being printed or committed.
- DEV store: `novahair-dev.myshopify.com`
- DEV store themes:
  - Published `test-data`: `160417873967`
  - Unpublished `Horizon`: `160417808431`
  - Unpublished `debut-vintage-theme`: `160417841199`
- `Funnel Builder` is not installed on the DEV store yet.

## Exact stopping point

1. A synthetic signed App Proxy request initially returned 401.
2. Boolean-only diagnostics showed `1011`: shop matched, signature shape was valid, secret existed, but timestamp freshness failed.
3. Cause: the workstation clock was about 15 minutes behind Cloudflare while the replay window is five minutes.
4. `verify_edge_preview.cjs` now calibrates synthetic signatures to the Edge `Date` header. This mirrors a real Shopify-generated proxy request and avoids weakening production replay protection.
5. After calibration, signed `/apps/funnels/api/proxy-health` returned 200 and signed `/ai-chat` reached the real model.
6. The real model replied in Hebrew with delivery throughout Israel and did not claim home delivery.
7. The edge assertion was relaxed only for equivalent correct wording: either `לכל הארץ` or `לכל נקודה בארץ`. It still rejects `עד הבית` and `נקודת איסוף`.
8. The temporary diagnostic response header was removed from local source. The boolean-only server warning remains.
9. Latest local test result: **56/56 tests passed**.
10. The clean local code after removing the diagnostic header has not yet been uploaded to the Preview alias, and the complete edge harness has not yet been rerun to its final PASS line.

## Resume here, in order

Run from `C:\Users\Lenovo\Desktop\Shopify-Internal-Funnel-App` unless a command says otherwise.

1. Compile the final local Worker:

   ```powershell
   Set-Location app/cloudflare-pilot
   npm run build
   ```

2. Upload a new Preview version only. Do not promote it:

   ```powershell
   npx wrangler versions upload --strict --preview-alias novahair-ai-qa --message "NovaHair AI clean edge QA"
   ```

3. Run the complete signed edge harness:

   ```powershell
   Set-Location ../..
   & 'C:\Users\Lenovo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' popup-engine/ai-popup/harness/verify_edge_preview.cjs
   ```

   Expected: a JSON success object. The test covers health, unsigned rejection, signed proxy health, a real signed AI call, wrong-shipping-copy rejection, protected admin API, and dashboard client-ID injection.

4. Re-run all local gates:

   ```powershell
   Set-Location app/cloudflare-pilot
   npm test
   npm run build
   ```

   Then run:

   ```powershell
   Set-Location ../..
   & 'C:\Users\Lenovo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' popup-engine/ai-popup/harness/verify_core.cjs
   & 'C:\Users\Lenovo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' popup-engine/ai-popup/harness/verify_dashboard_core.cjs
   ```

5. Re-run `popup-engine/ai-popup/harness/verify_ladder.py` and confirm all sampled answers avoid `עד הבית` and `נקודת איסוף`.

6. Create an isolated Shopify app-config working directory for `Funnel Builder` before any Shopify DEV command. It must contain only this app config and no unrelated extensions.

7. Install/configure the app on `novahair-dev.myshopify.com`, point its DEV App Proxy at the isolated QA Worker, and allowlist the DEV shop in an isolated DEV Worker configuration. Do not change the production allowlist just to make DEV pass.

8. Upload the theme assets and snippet only to an unpublished DEV theme. Use the opt-in render flag there. Verify mobile, desktop, lead capture, fallback behavior, analytics, and that every cart mutation remains single and deterministic.

9. Only after those checks should a separate activation plan be prepared for owner approval. Production activation is not part of the paused state.

## Current verification evidence

- Unit suite: 56/56 passing after the final middleware restructuring.
- TypeScript build: passed before the last small middleware restructuring; rerun is the first resume step.
- Browser popup QA: passed on mobile and desktop.
- Browser dashboard QA: passed.
- Signed edge auth: passed after clock calibration.
- Real edge model call: passed and returned acceptable Hebrew shipping language.
- Full clean Preview harness: still to be rerun after uploading the latest local code.

## Files changed for this feature

Primary implementation:

- `app/cloudflare-pilot/src/lib/shopify-app-proxy-auth.ts`
- `app/cloudflare-pilot/src/middleware/shopify-auth.ts`
- `app/cloudflare-pilot/src/routes/ai-concierge.ts`
- `app/cloudflare-pilot/src/lib/popup-analytics.ts`
- `app/cloudflare-pilot/src/server.ts`
- `app/cloudflare-pilot/src/worker.ts`
- `app/cloudflare-pilot/wrangler.jsonc`
- `app/cloudflare-pilot/public/admin/index.html`
- `popup-engine/ai-popup/assets/`
- `popup-engine/ai-popup/theme/novahair-ai-concierge.liquid`
- `popup-engine/ai-popup/admin/dashboard.html`

Tests and QA:

- `app/cloudflare-pilot/test/ai-concierge-security.test.ts`
- `app/cloudflare-pilot/test/shopify-app-proxy-auth.test.ts`
- `app/cloudflare-pilot/test/popup-event-contract.test.ts`
- `popup-engine/ai-popup/harness/verify_core.cjs`
- `popup-engine/ai-popup/harness/verify_dashboard_core.cjs`
- `popup-engine/ai-popup/harness/verify_edge_preview.cjs`

Operational docs:

- `popup-engine/ai-popup/DEPLOY.md`
- `popup-engine/ai-popup/HANDOFF_FOR_NEXT_DEV.md`
- `popup-engine/ai-popup/PAUSE-HANDOFF-2026-09-05.md`

## Secret hygiene

- Never paste secret values into docs, logs, screenshots, commits, or chat.
- The OpenRouter key source remains outside the repository at the previously documented local path.
- No temporary secrets file should remain in the repository. `.codex-tmp/ai-worker-dry-run` contains only Wrangler build output, not a secrets file.

