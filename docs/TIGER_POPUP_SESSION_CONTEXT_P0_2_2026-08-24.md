# TIGER Popup Platform — P0.2 Storefront Session Context Collector

Date: 2026-08-24  
Branch: `feat/tiger-popup-platform-phase1`  
PR: #4  
Release boundary: **STAGING ONLY — POPUP RENDERING STILL OFF**

## Why this exists

Qualified Commerce Traffic cannot become the denominator for popup experiments unless eligibility is fed by a consistent session context. This slice creates that context layer without publishing a popup to the Shopify storefront.

The collector is intentionally lightweight and deterministic. It collects approved acquisition, page, environment and behavior signals in the browser, then asks the server to normalize and verify the parts that must not be trusted from client input.

## Implemented files

- `app/storefront/popup-session-context.js`
- `app/src/lib/popup-session-context.ts`
- `app/src/lib/popup-session-token.ts`
- `app/src/routes/popup-runtime.ts`
- `app/admin/popup-context-lab.html`
- `app/test/popup-session-context.test.ts`
- `app/test/popup-session-token.test.ts`

Shared wiring changed:

- `app/src/server.ts`
- `app/.env.example`
- `app/package.json`
- `.github/workflows/ci.yml`

## Context captured

### First-touch acquisition per browser session

The browser collector records only recognized acquisition fields:

- `utm_source`
- `utm_medium`
- `utm_campaign`
- `utm_content`
- `utm_term`
- `fbclid`
- `gclid`
- `ttclid`
- Meta/ad identifiers when they are actually present in the URL:
  - ad ID
  - ad-set ID
  - campaign ID
  - creative ID
  - placement

The collector does **not** invent an ad ID from a Facebook/Instagram referrer. If an identifier is not present, it remains null.

### Navigation / commerce context

- current path
- landing path captured once per browser session
- minimized referrer origin + path
- inferred page role
- product handle when the URL is `/products/<handle>`
- optional funnel ID from explicit integration context
- commerce/support/tracking/unsubscribe intent
- anonymous new/returning marker

### Environment

Server normalization identifies:

- Instagram iOS in-app browser
- Instagram Android in-app browser
- Facebook iOS in-app browser
- Facebook Android in-app browser
- unknown-OS Meta in-app browser
- non-Meta environment

Browser-family dimensions include:

- iOS Safari
- desktop Safari
- Android Chrome
- iOS Chrome
- desktop Chrome
- Samsung Internet
- Firefox
- other

### Human/bot evidence

The browser collects lightweight behavior evidence:

- interaction count
- maximum scroll depth
- visible active time
- visibility changes

The server also checks automation/crawler/headless user-agent markers.

`humanLike=true` is evidence of observed interaction, not a claim that bot detection is perfect. `humanLike=null` means the system has not observed enough evidence yet. Known automation evidence wins over client interaction counters.

## Privacy minimization

The collector does not collect names, email addresses, phone numbers, addresses or arbitrary form contents.

Full arbitrary query strings are deliberately excluded from `pageUrl` and `referrer`. Only the approved acquisition fields listed above are parsed separately. This prevents an unrelated query parameter such as an email address from accidentally entering popup context.

The context API does not persist the P0.2 session snapshot. Persistence is intentionally deferred until the event/attribution contract is reviewed.

## Signed identity boundary

Browser-generated customer identity is not trusted.

P0.2 adds two HMAC-signed identity objects:

1. a server-created visitor ID with a signed visitor token;
2. a server-created session ID tied to that visitor with a signed session token.

Tokens are:

- bound to the configured Shopify shop domain;
- type-bound (`visitor` vs `session`);
- expiry checked;
- canonical-base64url checked;
- HMAC-SHA256 verified with constant-time signature comparison.

The browser stores the signed visitor token in local storage and the signed session token in session storage. An arbitrary browser-supplied `visitorId`, `sessionId` or Shopify customer ID is not accepted as server truth.

## Customer-history boundary

P0.2 deliberately does **not** resolve Shopify customer identity yet.

Browser input cannot self-declare:

- Shopify customer ID;
- purchase history;
- RFM segment;
- known-customer status.

`hasPurchaseHistory` stays `null` and `customerStateVerified=false` unless a future read-only server adapter supplies verified Shopify context. That adapter is a separate task and should remain read-only first.

## Country truth

Country is read server-side from edge headers in this order of available evidence:

- Cloudflare country header;
- Vercel country header;
- CloudFront viewer-country header.

The browser is not trusted to provide production country truth.

A special `x-tiger-test-country` header exists only when `POPUP_ALLOW_TEST_CONTEXT=true` and the runtime is not production.

## QCT connection

The server converts the normalized session into popup eligibility context and runs the QCT classifier.

Important nuance: current QCT V1 can return a qualified commerce class with `verification=PARTIAL` when some non-exclusion evidence, such as edge country or interaction evidence, is still missing. That is intentional for migration safety.

Campaign policy decides what happens next:

- `exclude_known_bad` blocks explicit exclusions and allows partial/unknown sessions;
- `qualified_only` permits only sessions whose classifier decision is `QUALIFIED`;
- `off` bypasses QCT for diagnostics.

Before revenue experiments use a strict denominator, staging QA should decide whether `qualified_only` must additionally require `verification=COMPLETE`. Do not silently reinterpret PARTIAL as fully verified business truth.

## Public staging runtime

Routes:

- `GET /popup-runtime/status`
- `POST /popup-runtime/session/bootstrap`
- `POST /popup-runtime/session/context`
- collector asset: `/popup-runtime/assets/popup-session-context.js`

These routes do **not** render a popup.

The collector is disabled unless all staging safety conditions are intentionally opened:

- `POPUP_STAGING_ENABLED=true`
- `POPUP_CONTEXT_COLLECTOR_ENABLED=true`
- `POPUP_KILL_SWITCH=false`
- a valid `POPUP_SESSION_SECRET` (or sufficiently strong configured Shopify secret fallback)
- allowed storefront origin

Defaults remain safe/off.

## Origin boundary

The runtime accepts exact origins from `POPUP_ALLOWED_STOREFONT_ORIGINS` and also includes the configured `SHOP_DOMAIN` myshopify origin.

The initial storefront collector is designed for same-origin / Shopify app-proxy use. Cross-origin CORS is not enabled in this slice.

## Context Lab

Private admin inspection page:

`/admin/popup-context-lab.html`

It displays:

- browser-observed local snapshot;
- page role;
- acquisition source;
- behavior evidence;
- signed identity when staging verification is enabled;
- server-normalized Meta/browser context;
- server QCT result.

The page itself never publishes or renders a customer popup.

## Collector usage in an unpublished staging theme

When the later Theme App Extension slice is approved, the intended integration is conceptually:

```html
<script src="/popup-runtime/assets/popup-session-context.js"></script>
<script>
  TigerPopupSessionContext.start({ serverRefreshMs: 15000 });
</script>
```

Do not paste this into the production theme now. The Theme App Extension / unpublished-theme installation and real storefront QA are separate release gates.

## Tests added

Coverage includes:

- edge-country derivation;
- test-country isolation;
- Facebook/Instagram in-app environment detection;
- acquisition/ad/creative dimension normalization;
- human-interaction evidence;
- automation UA overriding fake interaction evidence;
- browser inability to forge purchase-history truth;
- server-only promotion to verified customer state;
- collector-to-QCT integration;
- internal/test exclusion;
- signed visitor token verification;
- signed session identity tied to visitor;
- cross-shop rejection;
- token-kind rejection;
- signature mutation rejection;
- expiry rejection;
- minimum secret strength boundary.

CI is also configured to syntax-check the storefront collector and render the Context Lab in headless Chrome. The configuration is not itself proof of a successful final run.

## Verification status

- **CODE IMPLEMENTED:** YES
- **STATIC / UNIT TESTS COMMITTED:** YES
- **AUTOMATED CI VERIFIED GREEN:** NOT YET CLAIMED
- **CONTEXT LAB VERIFIED ON REAL HOST:** NO
- **UNPUBLISHED SHOPIFY THEME VERIFIED:** NO
- **REAL META IN-APP DEVICE VERIFIED:** NO
- **PRODUCTION POPUP ENABLED:** NO
- **PRODUCTION CHANGED BY THIS SLICE:** NO

## Next recommended engineering task

P0.3 should join popup/session eligibility to verified downstream Shopify commerce truth:

1. checkout reached;
2. order completed;
3. revenue;
4. eventual profit when the Profit OS fact is available;
5. idempotent attribution from signed session/visitor identity;
6. no-popup holdout support so incremental lift can be measured rather than inferred from popup clicks.

Customer/RFM lookup should remain a separate read-only adapter so attribution work does not accidentally create customer-write capabilities.
