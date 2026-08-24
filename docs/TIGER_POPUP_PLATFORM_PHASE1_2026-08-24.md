# TIGER Popup Platform — Phase 1 Engineering Handoff

Date: 2026-08-24  
Branch: `feat/tiger-popup-platform-phase1`  
Draft PR: #4  
Parent/base: `feat/tiger-profit-os-platform-v1`  
Release state: **STAGING / ADMIN ONLY — CUSTOMER POPUP RENDERING OFF**

## Verification status

Keep these states separate:

- **CODE IMPLEMENTED:** YES
- **AUTOMATED CI VERIFIED GREEN:** NOT YET CLAIMED
- **ADMIN / CONTEXT LAB VERIFIED ON A REAL HOST:** NO
- **UNPUBLISHED SHOPIFY THEME VERIFIED:** NO
- **REAL META IN-APP DEVICE VERIFIED:** NO
- **PRODUCTION VERIFIED:** NO
- **PRODUCTION CHANGED:** NO

A committed test or CI configuration is not proof of a successful hosted run.

## Source synchronization

The popup branch has been synchronized with the newer Profit OS / Commerce Intelligence parent work rather than overwriting it.

Latest explicit parent synchronization before P0.2 work:

- parent commit: `7fc743078d4677a265584319394ecc8ce08291eb`
- popup merge commit: `7a893b76560aa6212686ae29d3fc8f75a4a0d5cb`

The merge preserved the parent business-wide Qualified Commerce implementation, Commerce Intelligence admin surfaces, Bot Control work and parent proxy telemetry while retaining popup-specific work.

## Implemented popup platform foundation

### Campaign contract

`app/src/lib/popup-config-contract.ts`

Supports versioned campaigns, popup types, trigger rules, targeting, frequency caps, safety rules and A/B/C/D/n allocation. Mandatory safety behavior such as visible close, ESC close, local immediate close, focus restoration and body-scroll cleanup cannot be disabled by campaign input.

### Eligibility / experiment engine

`app/src/lib/popup-engine.ts`

Supports time, scroll, inactivity, desktop exit, cart and manual triggers plus page/product/funnel/source/referrer/UTM/visitor/cart targeting, close/submit suppression and impression caps.

Visitor assignment is deterministic from campaign + experiment version + visitor identity.

### Qualified Commerce Traffic V1

Files:

- `app/src/lib/popup-commerce-traffic.ts`
- `app/test/popup-commerce-traffic.test.ts`
- `docs/TIGER_QUALIFIED_COMMERCE_TRAFFIC_V1_2026-08-24.md`

Traffic can be classified as qualified paid/email/organic/direct/returning/unknown-source commerce or explicitly excluded as support, order tracking, unsubscribe, internal/test, bot/scanner, non-target market or non-commercial.

Gate modes:

- `exclude_known_bad` — migration-safe default;
- `qualified_only` — only classifier decisions of `QUALIFIED` pass;
- `off` — diagnostics only.

The current classifier only returns `QUALIFIED` with `verification=COMPLETE`: commercial context must be present, target-market country must be verified when the policy has target countries, `humanLike=true` must be observed, and no exclusion may apply. Missing country or human evidence returns `UNKNOWN` with `verification=PARTIAL`. `exclude_known_bad` can temporarily allow those unknown sessions during rollout, while `qualified_only` keeps the strict business denominator clean.

### P0.2 storefront session context collector

Files:

- `app/storefront/popup-session-context.js`
- `app/src/lib/popup-session-context.ts`
- `app/src/lib/popup-session-token.ts`
- `app/src/routes/popup-runtime.ts`
- `app/admin/popup-context-lab.html`
- `app/test/popup-session-context.test.ts`
- `app/test/popup-session-token.test.ts`
- `docs/TIGER_POPUP_SESSION_CONTEXT_P0_2_2026-08-24.md`

Implemented signals:

- first-touch UTM source/medium/campaign/content/term;
- fbclid/gclid/ttclid;
- ad/ad-set/campaign/creative IDs and placement only when actually supplied by acquisition URL context;
- current page and first landing path;
- product handle / explicit funnel ID;
- page role and commerce/support/tracking/unsubscribe intent;
- minimized referrer;
- browser/device context;
- Instagram/Facebook iOS/Android in-app browser classification;
- interaction count;
- maximum scroll depth;
- visible active time;
- visibility changes;
- automation/bot UA evidence;
- internal/test markers.

Country comes from trusted server/edge headers when available, not from a browser country claim.

Arbitrary page/referrer query strings are not copied into the context payload. Approved acquisition fields are parsed separately to reduce accidental PII collection.

### Signed visitor/session identity

The P0.2 runtime issues HMAC-signed, shop-bound visitor and session tokens. The browser does not get to declare an arbitrary trusted visitor/session ID.

Browser-provided Shopify customer IDs, purchase history or RFM state are not trusted. Verified customer history remains `null` until a future read-only Shopify customer adapter supplies it server-side.

### Public staging context routes

The following routes now exist solely for the session-context layer:

- `GET /popup-runtime/status`
- `POST /popup-runtime/session/bootstrap`
- `POST /popup-runtime/session/context`
- `/popup-runtime/assets/popup-session-context.js`

These do **not** publish or render a popup.

They are unavailable unless staging gates are intentionally opened. Default environment remains:

```text
POPUP_STAGING_ENABLED=false
POPUP_CONTEXT_COLLECTOR_ENABLED=false
POPUP_STAGING_EVENT_INGEST=false
POPUP_KILL_SWITCH=true
```

Allowed storefront origins are exact-match controlled. Cross-origin CORS is not enabled in this slice; later theme integration should prefer same-origin / Shopify app-proxy delivery.

### Popup persistence and admin API

Prisma models:

- `PopupCampaign`
- `PopupVariant`
- `PopupEvent`

Protected admin endpoints support config, simulator evaluation, QCT simulation, staging event ingestion and analytics. Event ingestion remains behind staging flags and the kill switch. Raw visitor/session IDs are hashed before persistence and common PII / browser-declared QCT metadata keys are stripped.

### Popup Studio

Files:

- `app/admin/popups.html`
- `app/admin/css/popups.css`
- `app/admin/js/popups.js`

Supports builder, targeting/triggers, experiments, safety, analytics, live creative preview, eligibility simulator and safety self-test. There is intentionally no production storefront publish action.

### Context Lab

Private inspection path when this branch is running:

`/admin/popup-context-lab.html`

It shows the browser snapshot and, when staging collector gates are enabled, signed identity, server-normalized context and QCT output. It does not render a customer popup.

### Fail-safe popup preview runtime

Files:

- `app/admin/js/popup-preview-runtime.js`
- `app/admin/popup-safety-test.html`

Close remains synchronous and local through visible X, ESC, optional backdrop, secondary CTA, form submit, programmatic close, replacement and timeout fallback. Cleanup does not wait for telemetry, Shopify, AI or any backend request.

## Test / CI coverage configured

Committed suites cover:

- campaign config safety;
- experiment allocation;
- sticky assignment;
- trigger and targeting boundaries;
- frequency suppression;
- QCT classification / exclusions / gate modes;
- edge-country normalization;
- Meta in-app environment detection;
- acquisition/ad/creative context;
- human/bot evidence;
- missing country remaining unqualified/unknown;
- browser inability to forge purchase history;
- signed visitor/session identity;
- cross-shop / token-kind / expiry / signature rejection;
- popup close fail-safe behavior.

CI is configured to:

- syntax-check admin JS and the storefront collector;
- validate Prisma;
- TypeScript build;
- run the full repository test suite;
- render Bot / Commerce Intelligence parent surfaces;
- render Popup Studio mobile + desktop;
- render Popup Context Lab;
- require the popup fail-safe browser test marker;
- require the Context Lab collector-ready browser marker;
- upload render artifacts.

Final CI success has not yet been confirmed through the available connector.

## Research playbook

`docs/POPUP_RESEARCH_PLAYBOOK_2026-08-24.md`

Contains 30 public popup/onsite case studies with company, type, trigger, design, offer, audience, reported result, source, why it may have worked and reusable principle. Vendor-reported outcomes are labeled directional rather than independent truth.

## Still intentionally NOT implemented / NOT deployed

- no customer-facing popup loader in a Shopify theme;
- no Theme App Extension injection;
- no production campaign publishing;
- no real discount issuance;
- no coupon-generation API;
- no browser margin logic;
- no Shopify customer writes;
- no customer tag/metafield writes;
- no CRM/email/SMS write automation;
- no AI request in a real-time customer popup path;
- no verified popup-to-Shopify purchase/revenue attribution yet;
- no global arbitration between simultaneously eligible campaigns yet;
- no no-popup incremental holdout runtime yet;
- no production deployment.

## Parent infrastructure blockers still apply

Before any production storefront runtime:

1. recover/confirm deployed Cloudflare Worker source and current D1 schema;
2. establish deployed-source parity with Git;
3. rotate/revoke historically exposed credentials;
4. keep all new secrets outside tracked files/history;
5. complete hosted Shopify embedded-auth / staging E2E;
6. confirm a dedicated unpublished staging theme remains unpublished.

## Recommended next sequence

1. Confirm CI success and inspect browser artifacts.
2. **P0.3 — verified downstream attribution:** signed eligible session → checkout → Shopify purchase → revenue → profit when available.
3. **P0.4 — campaign arbitration:** one deterministic winner when multiple campaigns are eligible.
4. **P0.5 — no-popup holdout:** sticky control group so incremental lift is measurable.
5. Add the provider-independent Shopify read-only customer/cart/product adapter.
6. Build the Theme App Extension loader restricted to an unpublished staging theme.
7. Run real Meta Facebook/Instagram in-app device QA, slow-network QA and close/failure torture tests.
8. Only after those gates, add server-authorized offer/discount capability.

## Rollback

The current popup work remains additive and production-unpublished. Keep all popup staging flags false and the kill switch true. Revert popup-specific commits/files if necessary without deleting the parent Profit OS, Commerce Intelligence or Bot work.

## Owner paths

Popup Studio:

`/admin/popups.html`

Context Lab:

`/admin/popup-context-lab.html`

These are application/admin paths when the branch is running, not claimed hosted staging URLs.
