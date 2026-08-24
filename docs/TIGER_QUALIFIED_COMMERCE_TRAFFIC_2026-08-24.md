# TIGER Qualified Commerce Traffic

Date: 2026-08-24
Branch: `feat/tiger-profit-os-platform-v1`
PR: #1
Release state: private admin / staging architecture only

## Objective

Stop judging acquisition performance with every raw Shopify visit in the denominator.

The clean KPI layer classifies reconstructed sessions as:

- `QUALIFIED`
- `EXCLUDED`
- `UNKNOWN`

`UNKNOWN` is intentionally not treated as zero, excluded or qualified. Missing evidence remains missing.

## Primary KPI contract

The primary cross-architecture metrics are:

1. Qualified Landing -> Checkout
2. Qualified Checkout -> Purchase
3. Qualified Landing -> Purchase
4. Revenue / Qualified Session
5. Qualified Revenue

ATC remains secondary when comparing funnels that may use different cart/direct-checkout/Buy Now/Funnelish architectures.

## Current deterministic classification

Default target country:

- `IL`

Configurable with:

- `QUALIFIED_COMMERCE_TARGET_COUNTRIES`
- `QUALIFIED_COMMERCE_INTERNAL_COUNTRIES`
- `QUALIFIED_COMMERCE_SESSION_TIMEOUT_MINUTES`

Current explicit exclusions include:

- test/synthetic/internal telemetry
- obvious bot/crawler/headless user agents
- known non-target geo
- contact/support entry
- order tracking/status entry
- unsubscribe/email-preference entry
- policy entry
- direct cart/checkout entry
- other known non-commercial entry paths

Unknown cases include:

- missing landing context
- missing geo when target geo is required

A session becomes `QUALIFIED` only when there is positive evidence of a target-geo commercial landing.

## Session reconstruction

Preferred identity:

- explicit commerce `sessionId`

Fallback:

- visitor ID with a configurable inactivity timeout, default 30 minutes
- checkout token when visitor identity is unavailable
- event identity as final isolated fallback

The funnel proxy now creates a commerce session in `sessionStorage` and captures:

- session ID
- session start time
- landing path
- current page path/URL
- referrer
- UTM source/medium/campaign
- browser family
- Meta in-app environment
- viewport width
- browser language
- user agent
- country code only when supplied by supported edge headers
- country source/provenance

The proxy also stores the session ID in `_funnel_context` so Shopify Web Pixel checkout events can retain the same commerce-session identity.

## Shopify checkout continuity

The Shopify pixel adapter remains deliberately reduced. It does not persist arbitrary raw Shopify browser event data.

The flow is now:

`funnel proxy -> _funnel_context.sessionId -> Shopify Web Pixel -> pixel ingest -> reduced checkout event payload.sessionId -> session reconstruction`

This lets landing/page events and checkout events join the same commerce session when the context is available.

## Purchase attribution rule

A purchase is attached to a reconstructed session only through an exact checkout-token match.

Orders that cannot be tied to a reconstructed session remain:

- `unattributedOrders`
- `unattributedRevenue`

They do not inflate Qualified Landing -> Purchase.

## New endpoint

`GET /api/commerce-intelligence/qualified-traffic`

Supported range values:

- `7d`
- `30d`
- `90d`
- explicit `from` / `to`

Response includes:

- clean KPIs
- classification coverage
- reason distribution
- qualified landing-page breakdown
- qualified source breakdown
- qualified device breakdown
- recent session QA rows
- explicit data-quality caveats

## New admin page

`app/admin/commerce-intelligence.html`

Supporting files:

- `app/admin/css/commerce-intelligence.css`
- `app/admin/js/commerce-intelligence.js`

The page is linked from the main admin navigation as `Commerce Intelligence`.

It explicitly displays:

- Qualified Sessions
- Landing -> Checkout
- Checkout -> Purchase
- Landing -> Purchase
- Revenue / Qualified Session
- Qualified Revenue
- classification coverage
- Qualified / Excluded / Unknown split
- exclusion/unknown reasons
- unattributed orders and revenue
- landing/source breakdowns
- session-level classification evidence

## Tests added/expanded

- `app/test/qualified-commerce.test.ts`
- `app/test/commerce-intelligence-ui.test.ts`
- `app/test/shopify-integration.test.ts`
- `app/test/analytics-contract.test.ts`

Covered behaviors include:

- target commercial session qualification
- missing geo remains UNKNOWN
- non-target geo exclusion
- support/tracking/unsubscribe/policy/direct-checkout exclusions
- bot/test exclusion
- inactivity session splitting
- exact checkout/purchase session join
- unattributed orders fail closed
- Shopify checkout pixel preserves session ID
- funnel -> pixel commerce-session continuity contract
- dashboard clean-KPI contract and responsive UI

## CI

CI now syntax-checks the Commerce Intelligence browser JS and renders:

- Commerce Intelligence mobile
- Commerce Intelligence desktop
- Bot Studio mobile/desktop
- Bot Control mobile/desktop

These artifacts are uploaded as `tiger-admin-ui-renders` when CI passes.

## Important limitations

### Historical Shopify session backfill is not implemented yet

The classifier operates on the app's normalized local event/session data and improved future telemetry.

The historical Shopify dataset used in business research is not automatically reconstructed by this code. A future historical importer must preserve source/provenance fields and feed them through the same classifier. Do not claim that the 2025/2026 historical Shopify baseline has already been backfilled into this dashboard.

### Non-proxy storefront pages may lack the new context

The new detailed session telemetry is injected on funnel pages served through the app proxy. Other storefront pages can remain UNKNOWN until a broader storefront telemetry path is intentionally implemented.

### Geo is fail-closed

Country is accepted when delivered through supported trusted edge headers or imported with provenance. The system does not infer country from language, UTM, browser or referrer.

### Profit is not yet part of this KPI

Revenue / Qualified Session is implemented. Contribution Profit / Qualified Session should only be added after authoritative Profit OS cost coverage is available. Missing cost must not become zero.

## QA state

Code implemented: YES
Automated CI: must pass on the final branch head before this slice is called CI verified
Staging verified: NO, not claimed by this document
Production verified: NO
Production deployment: NO

## Next recommended slice

After this clean denominator is stable:

1. Historical NovaHair control/autopsy + funnel/event semantics versioning.
2. Historical Shopify session backfill with provenance.
3. Creative Buyer Quality joined to qualified sessions/checkouts/purchases.
4. Bot holdout and session-intent infrastructure.
