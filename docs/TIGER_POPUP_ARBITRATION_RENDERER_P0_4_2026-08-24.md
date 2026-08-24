# TIGER Popup Platform — P0.4 Campaign Arbitration + Staging Renderer

Date: 2026-08-24

## Status

P0.4 is a staging-only implementation. It adds deterministic multi-campaign arbitration and a fail-safe renderer, but does not inject popup code into the production storefront.

Production-safe defaults remain:

- `POPUP_STAGING_ENABLED=false`
- `POPUP_CONTEXT_COLLECTOR_ENABLED=false`
- `POPUP_ATTRIBUTION_ENABLED=false`
- `POPUP_STAGING_RENDERER_ENABLED=false`
- `POPUP_KILL_SWITCH=true`

## Decision model

Every campaign is first evaluated by the existing eligibility engine. The arbitrator then returns one of three actions:

- `SHOW` — one eligible campaign is selected.
- `DEFER` — the campaign can be reconsidered later in the same session, for example while waiting for a trigger, another overlay, support flow, cart priority, or global cooldown.
- `SUPPRESS` — the campaign is not eligible under the current policy or is blocked by a hard condition such as checkout suppression.

Only one campaign can win a decision cycle.

## Arbitration order

1. Existing targeting, QCT, frequency and trigger eligibility.
2. Checkout suppression.
3. Support-flow priority: non-support campaigns defer while support intent is active.
4. Existing blocking modal/dialog detection.
5. Cart reservation: cart rescue and shipping-threshold campaigns get the transactional cart surface before generic campaigns.
6. Global popup cooldown.
7. Campaign `delivery.priority` descending.
8. Same-priority ties are deterministic for the same visitor using SHA-256 visitor/campaign bucketing.

## Per-campaign delivery policy

Each campaign now has a versioned `delivery` policy:

- `priority` — 0..1000.
- `conflictGroup` — normalized identifier reserved for cross-campaign conflict policy.
- `globalCooldownSeconds` — 0..3600.
- `deferWhenOverlayOpen` — defaults true.
- `reserveCartForCartCampaigns` — defaults true.
- `suppressOnCheckout` — defaults true.

The policy is persisted as `PopupCampaign.deliveryJson`.

## Frequency isolation

Frequency state is evaluated per campaign, not globally. A capped high-priority campaign does not incorrectly suppress a lower-priority campaign that is still eligible.

The current staging renderer keeps:

- session impressions in memory;
- visitor/day impressions in browser local storage;
- previous close and submit timestamps in browser local storage;
- a global last-popup timestamp for the short global cooldown.

This browser frequency state is a staging implementation. Production launch should move authoritative cross-device/customer frequency rules server-side where appropriate.

## P0.3 holdout integration

P0.4 does not replace P0.3 assignment. After arbitration selects a campaign, the server calls the existing deterministic P0.3 experiment assignment:

- `HOLDOUT` => terminal `SUPPRESS / experiment_holdout`, and no creative is returned.
- `POPUP` => the assigned variant is returned.

This keeps the no-popup control structurally separate from creative variants and preserves incremental purchase/revenue measurement.

## Runtime decision endpoint

`POST /popup-runtime/decision`

Requirements:

- staging context gate on;
- attribution gate on;
- staging renderer gate on;
- kill switch off;
- valid shop-bound signed popup session token;
- allowed origin.

The server normalizes browser/session context and returns only the selected variant creative when the decision is `SHOW`.

When `POPUP_STAGING_RENDERER_ENABLED=false`, the endpoint fails closed with a suppression decision and returns no creative.

## Renderer

Asset: `app/storefront/popup-renderer.js`

The renderer is inert until `TigerPopupRenderer.start()` is explicitly called.

It observes lightweight local signals and requests server decisions. It never decides which campaign or experiment variant should win by itself.

### Local fail-safe close behavior

Closing does not depend on any API, AI model, analytics request, coupon service, or Shopify request.

Supported local exits:

- visible X button;
- ESC;
- backdrop click when campaign safety permits;
- secondary action;
- maximum-open timeout;
- explicit renderer stop.

Cleanup includes:

- dialog DOM removal;
- body scroll restoration;
- keyboard listener cleanup;
- timeout cleanup;
- prior focus restoration.

Creative text is written with `textContent`; `innerHTML` and `insertAdjacentHTML` are not used. Optional campaign images must use HTTPS.

## Conflict signals sent by the staging renderer

- elapsed session time;
- scroll depth;
- inactivity;
- desktop exit intent;
- explicit manual trigger;
- cart item count/subtotal via a short-timeout same-origin `/cart.js` read;
- support intent;
- blocking modal/dialog presence;
- checkout context;
- per-campaign frequency state;
- global last-popup timestamp.

If cart lookup or the decision API fails, the page remains usable and no popup is rendered.

## P0.4 Runtime Lab

`/admin/popup-runtime-lab.html`

The lab can create two clearly synthetic draft campaigns and demonstrate:

- a high-priority campaign beating a lower-priority campaign;
- arbitration-only output;
- signed-session runtime decisions;
- holdout suppression;
- selected-variant rendering;
- local close and cleanup events.

The lab does not create real discounts, coupons, customer records or storefront changes.

## Tests

Added coverage includes:

- highest-priority eligible campaign selection;
- waiting trigger => `DEFER`;
- checkout suppression;
- support rescue priority;
- cart transactional priority;
- blocking-overlay deferral;
- global cooldown;
- per-campaign frequency isolation;
- deterministic same-priority tie-breaking;
- renderer inert-before-start boundary;
- no unsafe HTML insertion;
- X / ESC / backdrop / timeout local close paths;
- focus/body cleanup;
- server `SHOW` requirement before render;
- checkout/support/modal conflict signals.

## Still not production complete

P0.4 intentionally does not provide:

- production storefront injection;
- Theme App Extension deployment;
- production campaign publishing;
- real coupon/discount authorization;
- server-authoritative customer/RFM personalization;
- verified profit join;
- real Meta iOS/Android in-app QA;
- cross-device production frequency enforcement.

Those remain gated behind staging verification and explicit launch review.
