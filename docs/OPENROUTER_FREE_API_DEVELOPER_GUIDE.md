# OpenRouter Free API Developer Guide

Last reviewed: 2026-09-08

This runbook explains how this repository uses OpenRouter for:

1. NovaHair Concierge text responses in the Cloudflare Worker.
2. NovaHair shade-image analysis through a separate vision route.
3. Optional low-cost or free developer-task delegation from the command line.

It also explains the difference between **free-capable**, **strictly free**, and
the current **production reliability** configuration.

## Important cost truth

The current code is free-capable, but the default production configuration is
not guaranteed to cost exactly zero:

- The text-model ladder starts with `z-ai/glm-5.3-flash`, a very inexpensive
  paid model, before trying free models. It is the reliability anchor.
- The remaining text rungs use model IDs ending in `:free`.
- The image route currently uses `google/gemini-2.5-flash`, which is paid.
- The developer delegation helper also starts with the inexpensive paid model
  unless a free model is explicitly pinned.

For strict zero-cost experiments, pin `openrouter/free` or a currently
available model ID ending in `:free`. Do not describe the default production
configuration as guaranteed free.

OpenRouter states that accounts without at least 10 purchased credits normally
receive 50 free-model requests per day in total. Accounts with at least 10
purchased credits receive up to 1,000 free-model requests per day. Free model
availability and latency can change, so free inference is best treated as a
low-volume or fallback facility rather than a production uptime guarantee.

Official references:

- https://openrouter.ai/docs/quickstart
- https://openrouter.ai/docs/guides/routing/routers/free-router
- https://openrouter.ai/docs/guides/routing/model-variants/free
- https://openrouter.ai/docs/faq
- https://openrouter.ai/docs/guides/privacy/provider-logging
- https://openrouter.ai/docs/guides/features/zdr

## Architecture in this repository

### Storefront request path

The browser never receives the OpenRouter key.

```text
NovaHair storefront
  -> Shopify-signed App Proxy request
  -> Cloudflare Worker /apps/funnels/api/ai-chat
  -> OpenRouter /api/v1/chat/completions
  -> validated response or deterministic local fallback
```

Main server file:

```text
app/cloudflare-pilot/src/routes/ai-concierge.ts
```

The storefront AI route is mounted behind Shopify App Proxy signature
verification. Admin-only analytics routes are mounted separately and must not
be exposed through the storefront proxy.

### Secret ownership

`OPENROUTER_API_KEY` is a Cloudflare Worker secret. It must never be placed in:

- Shopify Liquid
- theme JavaScript or CSS
- `wrangler.jsonc`
- a committed `.env` file
- screenshots, logs, handoff messages, or test fixtures

The server reads it through `workerEnvValue("OPENROUTER_API_KEY")`.

### Text-model ladder

When `OPENROUTER_MODEL` is not set, the route tries the server-owned
`MODEL_LADDER` in order. At the time of this review it is:

```text
z-ai/glm-5.3-flash
nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free
minimax/minimax-m2.7:free
z-ai/glm-5.2:free
google/gemma-4-31b-it:free
```

Do not assume those free IDs will exist forever. Check the live model catalog
before changing or pinning a model:

```text
GET https://openrouter.ai/api/v1/models
```

Alternatively use `openrouter/free`, which lets OpenRouter select an available
free model that supports the request features.

### Why the ladder exists

Free models can be unavailable, rate-limited, slow, malformed, or inconsistent
with Hebrew and structured JSON. The route therefore:

- allows about 3.5 seconds per model;
- caps the whole ladder at about 8 seconds;
- continues to the next rung on timeout, network failure, non-2xx response,
  empty output, invalid output, or a failed quality gate;
- strips accidental Markdown JSON fences;
- extracts a balanced JSON object from surrounding prose;
- validates the returned flow node against a fixed allowlist;
- rejects foreign scripts, masculine addressing, and invented shade codes;
- returns `fallback: true` when every model fails.

The storefront handles `fallback: true` with deterministic local routing, so
an OpenRouter outage must not make the concierge or sales page unusable.

Approved commercial facts can bypass the model entirely through
`approvedFactAnswer()`. This prevents a model from inventing prices, delivery
times, guarantees, or product claims.

### Request shape

The production text route sends a standard OpenAI-compatible chat request:

```ts
const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://tigerbrandsglobal.com",
    "X-Title": "NovaHair AI Concierge",
  },
  body: JSON.stringify({
    model: "openrouter/free",
    max_tokens: 700,
    temperature: 0.6,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "<server-owned prompt>" },
      { role: "user", content: "<sanitized shopper message>" },
    ],
  }),
});
```

This snippet is illustrative. Do not create a second request implementation;
change the existing route and its tests.

## Getting an API key

1. Sign in at https://openrouter.ai/.
2. Create an API key in the OpenRouter dashboard.
3. Give it the minimum budget or limits appropriate for the environment.
4. Review account privacy settings before processing shopper text.
5. Keep input/output logging disabled unless there is an approved debugging
   reason and retention policy.
6. Disable routing to providers that may train on prompts when shopper content
   is involved.

Never send the key to another developer in chat. Each developer or environment
should receive a separately managed key when possible.

## Local setup

Set the key only in the current shell session:

```powershell
$env:OPENROUTER_API_KEY = Read-Host "OpenRouter API key"
```

Confirm only that the variable exists. Do not print its value:

```powershell
if ($env:OPENROUTER_API_KEY) { "OPENROUTER_API_KEY is set" }
```

Clear it when finished:

```powershell
Remove-Item Env:OPENROUTER_API_KEY
```

## Strict-free modes

### Automatic free router

Use this for experimentation when model identity may vary:

```powershell
$env:OPENROUTER_MODEL = "openrouter/free"
```

### Specific free model

Use a current model ID ending in `:free` when deterministic model selection is
more important. Verify the ID first through `/api/v1/models`.

```powershell
$env:OPENROUTER_MODEL = "<current-model-id>:free"
```

### Restore the repository ladder

Remove the override:

```powershell
Remove-Item Env:OPENROUTER_MODEL -ErrorAction SilentlyContinue
```

The route then uses `MODEL_LADDER` again.

## Cloudflare Worker setup

From the repository root:

```powershell
cd app/cloudflare-pilot
npx wrangler secret put OPENROUTER_API_KEY
```

Paste the key only into Wrangler's secret prompt.

Optional strict-free pin:

```powershell
npx wrangler secret put OPENROUTER_MODEL
```

Enter either `openrouter/free` or a verified `:free` model ID.

List secret names without revealing values:

```powershell
npx wrangler secret list
```

Run tests before deployment:

```powershell
npm test
npm run build
```

Deploy only after the tests pass:

```powershell
npx wrangler deploy
```

Do not deploy only to test whether a key works. Use the local QA scripts first.

## Repository QA commands

### Test the actual model ladder and production prompt

```powershell
python popup-engine/ai-popup/harness/verify_ladder.py
```

This script reads the prompt and ladder directly from
`ai-concierge.ts`, sends representative Hebrew questions, applies comparable
quality gates, and writes `_ladder_run.txt` beside the script.

### Benchmark currently available free models

```powershell
python popup-engine/ai-popup/harness/verify_live_model.py
```

The script fetches the live OpenRouter model list and tries available free
models. Its output is diagnostic, not permission to deploy a newly discovered
model without review.

### Compare selected free models

```powershell
python popup-engine/ai-popup/harness/verify_live_model.py --compare
```

### Worker regression suite

```powershell
cd app/cloudflare-pilot
npm test
npm run build
```

## Using OpenRouter for developer-task delegation

Helper:

```text
popup-engine/tools/delegate.py
```

The helper accepts a precise spec and writes one generated file. The human or
primary coding agent must review and test the result before it is used.

Default mode uses the helper's configured ladder, which currently starts with
the inexpensive paid reliability model:

```powershell
python popup-engine/tools/delegate.py path/to/spec.md path/to/output.file
```

Strict-free mode:

```powershell
python popup-engine/tools/delegate.py path/to/spec.md path/to/output.file --model openrouter/free
```

Specific free model:

```powershell
python popup-engine/tools/delegate.py path/to/spec.md path/to/output.file --model <current-model-id>:free
```

Delegated output is untrusted until reviewed. Never delegate secrets, customer
exports, order data, private keys, or an entire unredacted production dump.

## Vision route is separate

The shade-image endpoint is `/apps/funnels/api/ai-shade` and uses
`OPENROUTER_VISION_MODEL`. The current default is:

```text
google/gemini-2.5-flash
```

That model is not part of the free text ladder. The vision request currently
sets `provider: { zdr: true }`, validates the compressed image data URL, limits
the response schema, and reconciles the server result with a local suggestion.

Do not replace the vision model with `openrouter/free` without proving that the
selected free provider supports image input, structured output, latency, shade
accuracy, privacy requirements, and production use.

## Privacy and security requirements

- The OpenRouter key remains server-side.
- Storefront AI endpoints remain behind Shopify App Proxy verification.
- Never log Authorization headers or full request bodies.
- Do not send unnecessary customer identity, email, phone, address, order data,
  or cart contents to the model.
- Keep prompts bounded and sanitize context fields.
- Keep deterministic fallbacks available.
- Keep rate limiting enabled.
- Review OpenRouter account privacy settings and the selected provider policy.
- For sensitive requests, enforce ZDR per request with
  `provider: { zdr: true }` and test that a compatible endpoint is available.

Current accuracy note: the vision route enforces request-level ZDR. The text
route does not currently add `provider: { zdr: true }`; it relies on account and
provider settings. Do not claim request-level ZDR for text until that setting is
implemented and regression-tested.

## Common failure modes

| Symptom | Likely cause | Expected behavior |
|---|---|---|
| HTTP 401 | Missing or invalid key | Fix the server secret; never expose it client-side |
| HTTP 404 | Free model ID was removed | Refresh `/api/v1/models` or use `openrouter/free` |
| HTTP 429 | Shared free quota or local limit reached | Try the next rung or use deterministic fallback |
| HTTP 502/503 | Provider unavailable | Fall through; storefront remains usable |
| Empty response | Provider/model failure | Reject and try the next rung |
| Markdown around JSON | Weak structured-output compliance | Strip fences and parse the balanced object |
| Invalid flow node | Hallucinated route | Clear it unless it is in `ALLOWED_NEXT` |
| Slow popup response | Free-provider congestion | Enforce per-model and total deadlines |
| Unexpected cost | Paid rung or paid vision model used | Inspect the returned `model` and OpenRouter usage |

## Definition of done for changes

An OpenRouter-related change is not complete until:

1. No secret appears in `git diff`, logs, screenshots, or generated files.
2. `npm test` and `npm run build` pass in `app/cloudflare-pilot`.
3. Ladder QA passes representative Hebrew prompts.
4. Every failure path returns a deterministic usable fallback.
5. Commercial facts remain server-owned and are not generated freely.
6. The shopper flow cannot write or mutate cart lines through AI output.
7. Rate limits and timeouts remain bounded.
8. Privacy settings for the selected provider are documented and verified.
9. Strict-free mode is described as low-volume and best-effort.
10. The actual model returned by OpenRouter is observable without logging user
    prompt content.

## Copy-paste brief for another coding agent

```text
Use the existing OpenRouter integration in this repository. Do not create a
second client-side integration and do not expose OPENROUTER_API_KEY.

Read first:
- docs/OPENROUTER_FREE_API_DEVELOPER_GUIDE.md
- app/cloudflare-pilot/src/routes/ai-concierge.ts
- popup-engine/ai-popup/DEPLOY.md

For a strict-free local experiment, set OPENROUTER_MODEL=openrouter/free or a
currently verified :free model ID. Free availability and rate limits are not a
production SLA. Preserve the existing model deadlines, fallthrough behavior,
quality gates, allowed route IDs, deterministic commercial facts, rate limit,
and fallback:true response contract.

Never print, commit, or send the API key to the browser. Run the Worker tests,
build, verify_ladder.py, and the relevant storefront regression tests before
proposing deployment. Report the model actually used, whether the run was truly
zero-cost, and any privacy-policy assumption.
```
