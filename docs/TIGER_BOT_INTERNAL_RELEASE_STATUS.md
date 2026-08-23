# TIGER Bot — Internal Release Status

Status: **INTERNAL STAGING READY / STOREFRONT OFF**

This document describes the bot module on `feat/tiger-profit-os-platform-v1`. It is not permission to deploy the bot to storefront traffic.

## Implemented

- Clean responsive Bot Studio with profile/avatar preview, RTL Hebrew chat preview, simulator, knowledge, routing, offers, model experiments, CRM, security and analytics sections.
- Sales-first deterministic router with Support, Retention, Risk and Security precedence.
- Sales stages: DISCOVER → QUALIFY → RECOMMEND → OBJECTION → OFFER → CLOSE → FOLLOW_UP.
- Deterministic discount policy with margin floor and 5%/10% ladder configuration.
- Output policy that blocks secrets, internal economics, unauthorized discount percentages and invented coupon-code claims.
- Provider adapters for OpenAI, Gemini, Anthropic, xAI/Grok and a zero-cost mock provider.
- Sticky A/B/n model assignment persisted per conversation. Allocation changes do not silently move an active conversation while its assigned model remains enabled.
- Knowledge packs scoped by GLOBAL / PRODUCT / FUNNEL / PAGE_TYPE.
- Explicit CRM fact extraction with source-message provenance for name, email, phone and marketing consent.
- Per-visitor message rate limits and per-conversation provider/cost budgets.
- Staging commerce outcomes (ATC / checkout / purchase) with idempotency for validating model experiment analytics before storefront attribution exists.
- Model analytics for conversations, latency, AI cost coverage, ATC, checkout, purchases, conversion rate, revenue and contribution-profit coverage.
- Read-only Shopify order verification helper that searches by normalized order name and reveals a safe order/tracking summary only after exact email or phone verification.
- Shopify Admin GraphQL client with bounded retry/backoff for HTTP 429, 5xx and GraphQL `THROTTLED` responses.

## Guardrails

- Storefront runtime remains disabled.
- No theme injection, app embed or script-tag deployment exists in this batch.
- The LLM cannot grant itself tools or create discounts.
- A percentage authorization is not a coupon authorization.
- Customer-facing responses cannot expose COGS, supplier cost, internal margin, access tokens or API keys.
- Support/order lookup is designed to fail closed when identity cannot be verified.
- Legal-risk / explicitly human-required routes return a deterministic handoff rather than letting a generic model improvise.
- Model fallback is not silent; experiment integrity is preferred over hiding provider failures.
- Commerce outcome endpoints in this branch are staging-only and must not be treated as real revenue attribution.

## QA on branch

GitHub Actions runs:

1. `npm ci`
2. Prisma schema validation
3. Admin JavaScript syntax checks
4. TypeScript strict build
5. Full Node test suite
6. Headless Chromium 390×844 Bot Studio render
7. Headless Chromium 1440×1000 Bot Studio render
8. Screenshot artifact upload

The latest completed CI after the current bot/runtime hardening passed all of the above.

## Still blocking storefront deployment

1. Synchronize the currently deployed Cloudflare Worker/D1 production source back into Git and prove source parity. The Git repository must be the deployable source of truth before bot runtime work is attached to production.
2. Rotate/revoke the historically committed Meta credential and remove hardcoded secrets from current source; repository-history cleanup is a separate security operation.
3. Implement a server-issued/signed storefront conversation identity. Do not trust a visitor key supplied arbitrarily by browser JavaScript.
4. Connect real product/policy/shipping data and the authoritative Profit OS economics source.
5. Connect the real coupon allocator. The current bot can authorize a percentage but does not mint or disclose a coupon code.
6. Connect real signed storefront events to ATC / checkout / purchase attribution. Simulator outcomes are test data only.
7. Connect verified order/tracking reads to the production Shopify/CJ runtime, with required scopes and E2E verification.
8. Run hosted Shopify Admin auth E2E and production-like abuse tests before enabling any customer traffic.

## Explicitly deferred

- Customer-facing voice / TTS / realtime voice.
- Animated avatar/video agent.
- Storefront widget deployment.
- Automatic coupon generation.
- CJ tracking integration until production source parity is resolved.

The next deployment gate is not “more prompting”; it is production-source parity plus signed storefront identity and authoritative commerce tools.
