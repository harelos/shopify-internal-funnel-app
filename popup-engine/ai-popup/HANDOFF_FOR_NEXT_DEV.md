# NovaHair AI Concierge — Handoff for the next developer

**Date:** 2026-09-05
**Status:** Paused after isolated edge validation; no live storefront changes were made.
**Resume checkpoint:** Read `PAUSE-HANDOFF-2026-09-05.md` first. It supersedes the status and remaining-step estimates in this older handoff.

---

## The three files you must know by heart

| Purpose | Path |
|---|---|
| What's remaining, step by step | `popup-engine/ai-popup/DEPLOY.md` |
| System overview | `popup-engine/ai-popup/README.md` |
| Agents / router / lanes | `popup-engine/ai-popup/AGENTS.md` |

Everything below is a concrete pointer with an exact path, so nothing is guessed.

---

## Where everything actually lives (absolute paths on this machine)

### Frontend (goes into the Shopify theme)

**Storefront JS + CSS** — `C:\Users\Lenovo\Desktop\Shopify-Internal-Funnel-App\popup-engine\ai-popup\assets\`
- `novahair-ai-popup.js` — runtime (36 KB)
- `novahair-ai-popup.css` — styling (6 KB)
- `novahair-ai-flows.js` — every Hebrew node + branch (25 KB)
- `novahair-ai-facts.js` — grounded facts the LLM may cite (5 KB)
- `novahair-ai-agents.js` — router / lane picker (3 KB)
- `novahair-ai-tone.js` — output scrubber (6 KB)
- `novahair-ai-attribution.js` — UTM + click-id capture (6 KB)

**Base popup engine** — `C:\Users\Lenovo\Desktop\Shopify-Internal-Funnel-App\popup-engine\assets\`
- `novahair-popup-engine.js` (28 KB)
- `novahair-popup-engine.config.js` (7 KB)

**Images** — `C:\Users\Lenovo\Desktop\Shopify-Internal-Funnel-App\popup-engine\ai-popup\assets\img\`
- `advisor.png`, `shade-black.png`, `shade-dark_brown.png`, `shade-light_brown.png`, `shade-eggplant.png`, `shade-wine_red.png`
- **Rename with `nh-` prefix on upload** (Shopify flattens folders). The snippet references `nh-advisor.png`, `nh-shade-black.png`, etc.

**Snippet** — `C:\Users\Lenovo\Desktop\Shopify-Internal-Funnel-App\popup-engine\ai-popup\theme\novahair-ai-concierge.liquid` (4.6 KB)

### Backend (Cloudflare Worker)

- **Worker root:** `C:\Users\Lenovo\Desktop\Shopify-Internal-Funnel-App\app\cloudflare-pilot\`
- **Wrangler config:** `app\cloudflare-pilot\wrangler.jsonc`
  - Worker name: `shopify-funnel-control`
  - Deployed URL: `https://shopify-funnel-control.tigerbrands-funnel.workers.dev`
  - D1 binding: `DB` -> `shopify-funnel-control-db` (id `3b3d2e40-28b3-456f-9109-2607fbc51b17`)
- **Route file:** `app\cloudflare-pilot\src\routes\ai-concierge.ts`
  - Exports: `aiConciergeStorefront` (POST `/ai-chat`), `aiConciergeAdmin` (GET `/ai-steps`, `/ai-conversations`, `/ai-conversation`)
- **Wired in:** `app\cloudflare-pilot\src\server.ts` lines 17, 123, 141 (already done, do not touch)
- **Analytics library:** `app\cloudflare-pilot\src\lib\popup-analytics.ts` — adds `popup_ai_step` to the existing `popup_event` table. **No new DB migration is needed.**
- **Dashboard:** `popup-engine\ai-popup\admin\dashboard.html` (19 KB, opens against `/api/ai-steps` and `/api/ai-conversations`)

### Test harness (for local QA without Shopify)

- `popup-engine\ai-popup\harness\index.html` — open in any browser
- `popup-engine\ai-popup\harness\verify_ai.py` — 40/40 passing
- `popup-engine\ai-popup\harness\verify_live_model.py` — 3/3 passing

### Specs to read if you are confused

- Original brief: `C:\Users\Lenovo\Desktop\Funnel-Control-Prompts\01-adaptive-ai-popups-intervention-engine.md`
- Belief/objection map: `popup-engine\ai-popup\BELIEF_OBJECTION_MAP.md`
- Free LLM pool research: `popup-engine\ai-popup\FREE_LLM_POOL.md`

---

## Superseded deployment note (2026-09-05)

Do not use the old three-step sequence below as a go-live checklist. It was
written before proxy authentication, lead confirmation, cart serialization and
theme scoping were audited. The current authoritative checklist is `DEPLOY.md`.
In particular, `novahair-sales-staging` is the main sales page and must not be
used as an experimental target. QA belongs on an unpublished theme.

## Historical manual steps (do not execute verbatim)

### Step 1 — Register the Shopify App Proxy

Nothing works until this exists. Every request from the storefront (`/apps/funnels/api/ai-chat`, `/apps/funnels/api/track`, every step event) is routed through this proxy.

**Where:** Shopify Partners dashboard -> the app that holds this project's `SHOPIFY_CLIENT_SECRET` (the same secret the Worker uses to validate proxy signatures) -> App setup -> App proxy.

**Settings:**
- Subpath prefix: `apps`
- Subpath: `funnels`
- Proxy URL: `https://shopify-funnel-control.tigerbrands-funnel.workers.dev/apps/funnels`

**Save. Verify with:**
```bash
curl -X POST https://tigerbrandsglobal.com/apps/funnels/api/track -d "{}" -H "Content-Type: application/json" -i
```
Expected: **HTTP 401** from the Worker (unsigned request). If you see a Shopify **404 page**, the proxy is not registered yet.

### Step 2 — Set the OpenRouter key on the Worker

Obtain the OpenRouter key from the project owner or the approved secret manager.
Never store the key in this repository, a theme asset, a handoff document, or a
chat transcript. See `docs/OPENROUTER_FREE_API_DEVELOPER_GUIDE.md` for the full
setup and strict-free configuration.

```powershell
cd C:\Users\Lenovo\Desktop\Shopify-Internal-Funnel-App\app\cloudflare-pilot
npx wrangler secret put OPENROUTER_API_KEY
# when prompted, paste the secret value from the approved secret manager
```

Optional — pin one model instead of the ladder:
```powershell
npx wrangler secret put OPENROUTER_MODEL
# e.g. z-ai/glm-4.5-flash
```

For local dev, drop the key in `app\cloudflare-pilot\.dev.vars` (gitignored):
```
OPENROUTER_API_KEY=replace-with-local-secret
```

### Step 3 — Upload theme assets + snippet, then deploy the Worker

**A. Upload 15 files to `theme/assets/`** (Shopify Admin -> Online Store -> Themes -> Edit code -> Assets -> Add a new asset). Rename on upload to the final names below:

```
novahair-popup-engine.js
novahair-popup-engine.config.js
novahair-ai-flows.js
novahair-ai-facts.js
novahair-ai-agents.js
novahair-ai-tone.js
novahair-ai-popup.js
novahair-ai-popup.css
novahair-ai-attribution.js
nh-advisor.png            (was advisor.png)
nh-shade-black.png        (was shade-black.png)
nh-shade-dark_brown.png   (was shade-dark_brown.png)
nh-shade-light_brown.png  (was shade-light_brown.png)
nh-shade-eggplant.png     (was shade-eggplant.png)
nh-shade-wine_red.png     (was shade-wine_red.png)
```

**B. Add the snippet** to `theme/snippets/novahair-ai-concierge.liquid`:
Copy the whole contents of `popup-engine\ai-popup\theme\novahair-ai-concierge.liquid`.

**C. Render it** only in an unpublished theme's NovaHair layout:
```liquid
{% render 'novahair-ai-concierge', enabled: true, placement: 'exit_sales' %}
```

**D. Deploy the Worker:**
```powershell
cd C:\Users\Lenovo\Desktop\Shopify-Internal-Funnel-App\app\cloudflare-pilot
npx wrangler deploy
```

---

## How to verify each step worked

| Verification | Command / URL | Expected |
|---|---|---|
| Proxy registered | Open `https://tigerbrandsglobal.com/apps/funnels/api/proxy-health` | `{"ok":true,"service":"novahair-ai-concierge"}` |
| OpenRouter secret exists | `npx wrangler secret list` | `OPENROUTER_API_KEY` listed |
| Worker deployed | Open `https://shopify-funnel-control.tigerbrands-funnel.workers.dev/api/health` | `{"status":"ok",...}` |
| Snippet renders | View source through the unpublished theme preview URL | contains the AI asset names; published theme remains unchanged |
| Preview end-to-end | Open the unpublished theme preview on mobile and trigger exit intent | Concierge opens; free text returns Hebrew or the safe local fallback |
| Analytics flowing | Open `/admin/ai-concierge.html` inside the authenticated app | Per-step funnel populates within minutes |

---

## What is missing (real gaps, non-blocking)

1. **Rate limiter is per-isolate.** 15 req/min per IP, in memory. If two Worker isolates handle the same shopper, each has its own counter -- soft limit. Hard version = a D1 counter table with `INSERT OR REPLACE` per (ip, minute). Only needed if abuse shows up.

2. **`/ai-steps` returns up to 20K events per query.** No pagination. Fine for weeks or months of traffic; add `LIMIT/OFFSET` before it hits a real 20K.

3. **Multi-provider adapter not built.** The ladder is OpenRouter-only. Groq and Cerebras (both have free tiers with faster time-to-first-token) would need a new adapter file. See `FREE_LLM_POOL.md` for the shortlist.

4. **Email capture** includes a required consent checkbox and submits
   `accepts_marketing=true`. A lead is counted only after the Worker verifies
   the one-time tag and Shopify reports the customer as `SUBSCRIBED`.

5. **Only two conversation scenarios are built** (shade anxiety, price resistance). The engine supports more; add new nodes to `novahair-ai-flows.js` and they appear in analytics automatically. Shared proof nodes (`proof_roots`, `proof_how`, `escalate`, `graceful`) can be reused.

6. **The photo shade matcher runs entirely in the browser** and the Hebrew copy promises exactly that. If you ever move it server-side, change the promise line first -- otherwise it becomes a lie.

7. **Step IDs are stable analytics keys.** Never rename an existing node -- add a new one. Renaming silently breaks historical comparison in the dashboard.

---

## Guardrails baked into the code (do not remove)

- **Router precedence is safety-first**: any complaint / order-status / medical detection routes to the `service` lane and disables selling (including for VIPs). See `AGENTS.md` for the exact precedence table.
- **Coupon rules per lane**: `sales` may spend the first-order coupon on price hesitation; `retention` and `vip` may not (she is not a first-order customer); `service` never.
- **Model output is scrubbed**: emojis, markup, foreign script, invented shade codes, masculine address, em dashes.
- **Model reply is validated**: it must return `{"reply", "next"}` where `next` is in an allowlist of node ids. Hallucinated steps cannot break the flow.
- **With no key or 5xx**, the route returns 503 and the client falls back to keyword routing rather than dead-ending the shopper.
