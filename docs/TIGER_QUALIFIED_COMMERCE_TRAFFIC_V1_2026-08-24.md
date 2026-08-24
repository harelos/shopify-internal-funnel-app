# TIGER Qualified Commerce Traffic — V1

Date: 2026-08-24  
Branch: `feat/tiger-popup-platform-phase1`  
Release state: **PRIVATE STAGING / ADMIN ONLY**

## Why this exists

Raw Shopify sessions are not a reliable denominator for TIGER popup optimization when the store contains support visits, order tracking, unsubscribe traffic, internal testing, scanners/bots, non-target markets, and other non-commercial sessions.

The popup platform therefore has a deterministic **Qualified Commerce Traffic (QCT)** contract. Its job is to classify session context before normal popup targeting and to keep known-bad traffic out of popup decisions and future commerce KPI baselines.

This is not an AI classifier. Missing evidence remains `UNKNOWN`; the system does not invent intent.

## Current policy

Policy version: `1`

Current target market default:

- `IL`

This is configurable in popup campaign targeting through `qualifiedCountries`, but the TIGER default remains Israel because that is the current commercial baseline being modeled.

## Classes

Qualified classes:

- `QUALIFIED_PAID_COMMERCE`
- `QUALIFIED_EMAIL_COMMERCE`
- `QUALIFIED_ORGANIC_COMMERCE`
- `QUALIFIED_DIRECT_COMMERCE`
- `QUALIFIED_RETURNING_CUSTOMER_COMMERCE`
- `QUALIFIED_UNKNOWN_SOURCE_COMMERCE`

Excluded classes:

- `EXCLUDED_SUPPORT`
- `EXCLUDED_ORDER_TRACKING`
- `EXCLUDED_UNSUBSCRIBE`
- `EXCLUDED_INTERNAL_TEST`
- `EXCLUDED_BOT_OR_SCANNER`
- `EXCLUDED_NON_TARGET_MARKET`
- `NON_COMMERCIAL`

Unresolved:

- `UNKNOWN`

## Classification precedence

The classifier intentionally checks hard exclusions before positive commerce signals.

1. Internal/test session
2. Bot/scanner evidence
3. Unsubscribe intent/page
4. Order-tracking intent/page
5. Support/contact intent/page
6. Known non-target country
7. Policy/account/non-commercial content
8. Commercial-page or explicit-commerce evidence
9. Target-market verification
10. Human-like verification
11. Source classification

A Facebook UTM does not override a support page. A product page does not override known bot evidence. A strong paid source does not override a known non-target market.

## What counts as verified qualified traffic in V1

For `decision = QUALIFIED`, the classifier needs:

- commercial context, AND
- a known allowed country when target countries are configured, AND
- `humanLike = true`, AND
- no exclusion signal.

If commercial context exists but country or human verification has not yet been collected, the result is `UNKNOWN`, not a guessed qualified session.

P0.2 now implements the session-context contract that can supply these signals, but it has not yet been installed or verified on an unpublished Shopify theme. Therefore the classification logic is implemented while real storefront measurement remains unverified.

## Enforcement modes

Popup campaign targeting supports:

### `exclude_known_bad` — current default

- blocks `EXCLUDED`
- allows `QUALIFIED`
- temporarily allows `UNKNOWN`

This is the migration-safe mode while the P0.2 collector is being validated in staging. It immediately prevents known support/tracking/unsubscribe/internal/bot/non-target traffic from qualifying without pretending unverified storefront evidence is complete.

### `qualified_only`

- allows only `QUALIFIED`
- blocks both `EXCLUDED` and `UNKNOWN`

Because the current classifier only returns `QUALIFIED` after country and human evidence are complete, this is the strict Qualified Commerce denominator intended for real revenue experiments after staging validation.

### `off`

- bypasses QCT gating

This exists for controlled diagnostics, not as the recommended production setting.

## Page-role inference

The classifier recognizes deterministic roles for common storefront paths:

- product
- collection
- homepage
- funnel when a funnel ID exists
- cart
- checkout
- contact
- tracking
- unsubscribe
- policy
- account
- content/blog
- unknown

Content/blog traffic is treated as non-commercial unless explicit commercial intent is provided. Unknown custom pages stay unknown unless another trusted signal marks them commercial.

## Source inference

After a session is verified as commerce traffic, source is classified separately as:

- paid
- email
- organic
- direct
- returning customer
- unknown source

Returning-customer status requires factual purchase history; it is not inferred from model prose.

## Popup integration

`evaluatePopupEligibility()` attaches the QCT classification to every result and applies the campaign's QCT gate before normal popup path/product/UTM/cart/frequency/trigger evaluation.

Stable rejection reasons:

- `commerce_traffic_excluded`
- `commerce_traffic_not_qualified`

The detailed class and reason codes remain available in `result.commerceTraffic` for operator diagnostics.

## Admin API

Private deterministic simulator endpoint:

`POST /api/popups/commerce-traffic/evaluate`

It accepts context signals and optional target countries and returns the server-derived classification. It does not invoke AI and does not publish anything.

## Browser trust boundary

Browser popup-event metadata is not allowed to self-declare QCT class/decision as a factual analytics dimension. Keys such as `commerceTrafficClass` and `qualifiedCommerceTraffic` are stripped from untrusted event metadata.

Production analytics must derive QCT server-side from normalized session context.

## P0.2 collector connection

Implemented context layer:

- `app/storefront/popup-session-context.js`
- `app/src/lib/popup-session-context.ts`
- `app/src/lib/popup-session-token.ts`
- `app/src/routes/popup-runtime.ts`
- `docs/TIGER_POPUP_SESSION_CONTEXT_P0_2_2026-08-24.md`

It supplies server-derived country where edge headers exist, page/funnel context, approved acquisition dimensions, Meta in-app/browser context, behavior/human evidence, bot markers, internal/test flags and signed visitor/session identity.

Customer purchase history is deliberately not trusted from the browser and remains unresolved until the read-only Shopify customer adapter exists.

## Tests

Coverage includes:

- Israeli Meta paid traffic
- internal/test exclusion
- bot/scanner exclusion
- contact/support exclusion
- order-tracking exclusion
- unsubscribe exclusion
- non-target market exclusion
- policy/content exclusion
- returning-buyer class
- email/organic/direct source classes
- unknown commerciality
- missing country/human evidence remaining unknown
- enforcement-mode behavior
- popup-engine suppression before normal trigger logic
- collector-to-QCT normalization
- signed visitor/session identity boundaries

## Verification state

- **CODE IMPLEMENTED:** YES
- **P0.2 COLLECTOR CONTRACT IMPLEMENTED:** YES
- **AUTOMATED CI VERIFIED:** NOT YET CLAIMED in this document
- **REAL STOREFRONT CONTEXT VERIFIED:** NO
- **UNPUBLISHED SHOPIFY THEME VERIFIED:** NO
- **PRODUCTION VERIFIED:** NO
- **PRODUCTION CHANGED:** NO

## Next task

P0.3 should connect signed eligible sessions to verified downstream Shopify checkout/order/revenue facts. After hosted staging and real Meta in-app validation, revenue experiments can move from `exclude_known_bad` to the strict `qualified_only` denominator.
