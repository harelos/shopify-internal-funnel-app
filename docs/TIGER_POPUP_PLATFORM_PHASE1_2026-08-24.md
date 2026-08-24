# TIGER Popup Platform — Phase 1 Engineering Handoff

Date: 2026-08-24  
Branch: `feat/tiger-popup-platform-phase1`  
Draft PR: #4  
Parent/base: `feat/tiger-profit-os-platform-v1`  
Release state: **STAGING / ADMIN ONLY — STOREFRONT OFF**

## Verification status

These states are intentionally separate:

- **CODE IMPLEMENTED:** YES
- **AUTOMATED CI VERIFIED:** NOT YET CLAIMED — CI checks are configured on the branch, but a successful final run has not been confirmed in this handoff.
- **ADMIN PREVIEW VERIFIED ON A REAL HOST:** NO
- **STAGING SHOPIFY THEME VERIFIED:** NO — no storefront loader exists yet.
- **PRODUCTION VERIFIED:** NO
- **PRODUCTION CHANGED:** NO

Do not promote any of the NO / NOT YET CLAIMED states based only on compilation or code review.

## Source synchronization performed

The popup branch was originally cut from an earlier parent commit. While this work was in progress, the parent branch advanced with Bot Control / truth-hierarchy work. The popup branch was then explicitly synchronized with parent commit `94a8c7ab4c0846f96134b0a1ab30b007239e6ceb` instead of overwriting newer parent work.

The resulting merge commit is `0be6acec27c7ed7ee38bdcd5b969218474642ac7`.

The combined CI and `package.json` preserve the newer Bot Control tests/render checks while adding popup tests and popup browser QA.

## Phase 1 scope implemented

### 1. Campaign configuration contract

Files:

- `app/src/lib/popup-config-contract.ts`

Implemented:

- popup campaign/version model
- popup types:
  - lead capture
  - discount reveal
  - quiz
  - product finder
  - bundle suggestion
  - browse abandonment
  - cart rescue
  - reorder
  - support rescue
  - returning-customer recommendation
  - content/guide
  - shipping-threshold prompt
- variant creative contract
- trigger contract
- targeting contract
- frequency contract
- safety contract
- exact A/B/C/D/n basis-point allocation validation
- duplicate variant-key prevention
- cart min/max validation
- qualified-commerce-traffic gate mode
- campaign target-country list for commerce qualification

Mandatory safety settings such as visible close, ESC close, immediate local close, focus restoration and body-scroll cleanup are normalized to `true` and cannot be disabled by campaign input.

### 2. Deterministic trigger / targeting / experiment engine

Files:

- `app/src/lib/popup-engine.ts`

Implemented inputs:

- time on page
- scroll depth
- inactivity
- desktop exit intent
- cart state
- manual/CTA trigger
- page include/exclude rules
- product
- funnel
- traffic source
- referrer
- UTM source
- visitor state
- cart subtotal range
- require-cart rule
- previous close
- previous submit
- session impression cap
- visitor/day impression cap
- qualified-commerce-traffic classification before normal popup targeting

Experiment assignment is deterministic using campaign key + experiment version + visitor ID. The model is not allowed to randomly switch popup variants mid-conversation/session.

### 3. Qualified Commerce Traffic V1

Files:

- `app/src/lib/popup-commerce-traffic.ts`
- `app/test/popup-commerce-traffic.test.ts`
- `docs/TIGER_QUALIFIED_COMMERCE_TRAFFIC_V1_2026-08-24.md`

Purpose:

Raw Shopify sessions are not treated as the future popup KPI denominator. The platform now has a deterministic commerce-traffic classifier that separates verified commerce traffic from known support/tracking/unsubscribe/internal/bot/non-target/non-commercial traffic.

Current classes include:

Qualified:

- `QUALIFIED_PAID_COMMERCE`
- `QUALIFIED_EMAIL_COMMERCE`
- `QUALIFIED_ORGANIC_COMMERCE`
- `QUALIFIED_DIRECT_COMMERCE`
- `QUALIFIED_RETURNING_CUSTOMER_COMMERCE`
- `QUALIFIED_UNKNOWN_SOURCE_COMMERCE`

Excluded:

- `EXCLUDED_SUPPORT`
- `EXCLUDED_ORDER_TRACKING`
- `EXCLUDED_UNSUBSCRIBE`
- `EXCLUDED_INTERNAL_TEST`
- `EXCLUDED_BOT_OR_SCANNER`
- `EXCLUDED_NON_TARGET_MARKET`
- `NON_COMMERCIAL`

Unresolved:

- `UNKNOWN`

Current policy version is `1` and the default target country is `IL`.

A session is only marked `QUALIFIED` when commercial context, target-market evidence and `humanLike=true` are all present and no exclusion applies. Missing evidence becomes `UNKNOWN`; it is not guessed.

Gate modes:

- `exclude_known_bad` — current migration-safe default. Blocks known exclusions while allowing unresolved sessions until the storefront collector exists.
- `qualified_only` — strict mode. Allows only fully qualified commerce traffic.
- `off` — diagnostic bypass.

The popup eligibility engine attaches QCT classification to every decision and applies the gate before normal path/product/UTM/cart/frequency/trigger evaluation.

A private deterministic simulator endpoint was also added:

- `POST /api/popups/commerce-traffic/evaluate`

Browser event metadata is not trusted to self-declare QCT. Browser-supplied derived QCT keys are stripped from event metadata so future analytics cannot accidentally treat a client claim as server truth.

Important boundary:

The real storefront session-context collector is **not implemented yet**, so QCT is structurally implemented but not claimed as production-measured traffic.

### 4. Staging persistence and event model

Files:

- `app/prisma/schema.prisma`

Added:

- `PopupCampaign`
- `PopupVariant`
- `PopupEvent`

Important data rules:

- events are test/staging records in this phase
- event key is unique for idempotency
- raw visitor/session IDs are not persisted by the popup event route
- visitor/session IDs are server-hashed before persistence
- common PII metadata keys are stripped from event metadata
- client-supplied QCT classifications are stripped rather than trusted as business truth

### 5. Protected admin API

Files:

- `app/src/routes/popups.ts`
- `app/src/server.ts`

Routes:

- `GET /api/popups/status`
- `GET /api/popups/config`
- `PUT /api/popups/campaigns/:key`
- `POST /api/popups/evaluate`
- `POST /api/popups/commerce-traffic/evaluate`
- `POST /api/popups/events`
- `GET /api/popups/analytics`

Safety gates:

- `storefrontEnabled` is hard-coded `false` in Phase 1 runtime status
- `POPUP_STAGING_ENABLED` defaults disabled
- `POPUP_STAGING_EVENT_INGEST` defaults disabled
- `POPUP_KILL_SWITCH` defaults ON
- event ingestion returns a disabled response unless the staging gates are intentionally opened
- no public storefront endpoint was added

### 6. Popup Studio admin UI

Files:

- `app/admin/popups.html`
- `app/admin/css/popups.css`
- `app/admin/js/popups.js`

Sections:

- Builder
- Targeting & Triggers
- Experiments
- Safety
- Analytics

The UI supports:

- draft campaign editing
- popup-type selection
- Hebrew RTL / LTR / auto creative direction
- form-mode preview
- trigger and targeting setup
- frequency limits
- A/B/C/D/n variant creation/removal
- exact weight validation
- live visual creative preview
- eligibility simulator
- safety self-test
- staging event analytics view

There is intentionally **no Publish to Storefront button**.

### 7. Fail-safe local preview runtime

Files:

- `app/admin/js/popup-preview-runtime.js`
- `app/admin/popup-safety-test.html`

Implemented close paths:

- visible X
- ESC
- backdrop when enabled
- secondary CTA
- form submit
- programmatic close
- hard timeout fallback
- replacement of an already-open preview

Failure behavior:

- close is synchronous/local
- close does not await telemetry
- close does not await Shopify
- close does not await AI/personalization
- close does not require API connectivity
- event callbacks run best-effort asynchronously and cannot block cleanup
- original body overflow/padding is restored
- focus is restored best-effort
- timers and event listeners are removed
- the old root DOM node is removed

Creative strings are rendered with DOM `textContent`; the preview does not inject supplied creative as arbitrary HTML.

### 8. Automated test coverage added

Files:

- `app/test/popup-config-contract.test.ts`
- `app/test/popup-commerce-traffic.test.ts`
- `app/test/popup-engine.test.ts`
- `app/test/popup-ui-preview-server.mjs`

Covered/tested by the committed suites:

- mandatory close/safety settings cannot be turned off
- variant allocation must equal 10,000 basis points
- invalid cart min/max is rejected
- sticky assignment stays stable
- time-trigger boundary
- desktop exit intent does not pretend to work on mobile
- close suppression
- session frequency cap
- compound page + UTM + cart targeting
- Israeli Meta paid-commerce classification
- support/tracking/unsubscribe/internal/test/bot/non-target exclusions
- non-commercial page exclusion
- returning/email/organic/direct commerce classes
- unknown evidence remains unknown
- `exclude_known_bad` vs `qualified_only` gate behavior
- known-bad QCT is blocked before normal popup trigger logic

CI is configured to:

- syntax-check popup admin JS
- validate Prisma
- TypeScript build
- run the repository test suite including popup tests
- render Popup Studio at 390×844
- render Popup Studio at 1440×1000
- run the isolated fail-safe browser self-test
- require `data-popup-safety-self-test="pass"`
- upload popup screenshot/safety artifacts

A CI configuration is not itself proof of a passing run; the final workflow result must be inspected separately.

### 9. Popup research playbook

File:

- `docs/POPUP_RESEARCH_PLAYBOOK_2026-08-24.md`

Contains 30 public popup/onsite examples, exceeding the requested minimum of 25. Each row records the available company, popup type, trigger, design, offer/value, audience, reported result, source, why it may have worked, and reusable principle.

Public vendor-reported performance is labeled as directional evidence, not guaranteed or independently audited truth. Missing implementation details are marked as not specified instead of invented.

## Environment additions

File:

- `app/.env.example`

Added:

```text
POPUP_STAGING_ENABLED=false
POPUP_STAGING_EVENT_INGEST=false
POPUP_KILL_SWITCH=true
POPUP_EVENT_HASH_PEPPER=
```

`POPUP_EVENT_HASH_PEPPER` must come from a real secret store before staging event ingestion is enabled. It must not be committed with a real value.

## Intentionally NOT implemented in Phase 1

Do not interpret these as bugs; they are release boundaries:

- no live storefront popup loader
- no storefront session-context collector yet
- no Theme App Extension popup injection
- no production campaign publishing
- no real discount issuance
- no coupon-generation API
- no margin logic in the browser
- no Shopify customer writes
- no customer tags/metafield writes
- no Shopify Email / Flow write integration
- no CRM marketing automation
- no SMS/phone capture workflow
- no AI/personalization request in a customer popup path
- no verified Shopify purchase/revenue attribution for popup experiments yet
- no global arbitration between multiple simultaneously eligible campaigns yet
- no production deployment

## Known blockers before storefront integration

Parent-branch infrastructure blockers remain authoritative:

1. Recover deployed Cloudflare Worker source.
2. Recover current D1 schema.
3. Compare deployment with Git and establish source parity.
4. Rotate/revoke historically exposed credentials.
5. Keep secrets out of tracked files/history going forward.
6. Complete hosted Shopify embedded-auth / real staging E2E.
7. Confirm a dedicated unpublished staging theme remains unpublished.

Do not add a storefront runtime until those boundaries are understood.

## Required Phase 2 before any real staging popup traffic

Recommended order:

1. Confirm CI green and inspect mobile/desktop render artifacts.
2. Build the lightweight storefront session-context collector, including country, page/funnel context, UTM/source, browser/webview, and human/bot evidence required by QCT.
3. Add campaign arbitration when multiple campaigns are eligible.
4. Add a provider-independent product/cart/customer context adapter with strict read-only capability first.
5. Build a Theme App Extension loader that is restricted to the unpublished staging theme and still has the local kill switch.
6. Add real storefront QA tests for X / ESC / backdrop / navigation / AJAX redraw / history / refresh / mobile rotation / slow network / backend failure.
7. Only after the shell is proven safe, add server-authorized offer/discount adapters.
8. Join popup conversion events to verified Shopify order events before reporting revenue lift.

## Rollback

Phase 1 is additive and production is unchanged. Rollback is:

1. Keep popup environment gates false and kill switch true.
2. Revert the popup branch/PR or individual popup files.
3. Remove popup Prisma models only through a reviewed migration if they have actually been deployed to a persistent staging database.
4. Do not delete shared Bot/Profit OS parent work while reverting popup files.

## Owner preview path

When this branch is run in the private app/admin environment, the intended admin route is:

`/admin/popups.html`

This is an **admin preview path**, not a live storefront URL. No staging-host URL is claimed until one has actually been deployed and checked.
