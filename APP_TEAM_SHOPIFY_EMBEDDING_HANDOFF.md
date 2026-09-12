# NovaHair Lifecycle Analytics Shopify App Handoff

## Purpose and current state

This document is the implementation brief for the application team. Its job is to move the existing NovaHair Lifecycle Analytics screen from a private external portal into the Shopify Admin, under **Apps**, without changing the production lifecycle engine or exposing customer data or credentials.

The lifecycle engine is already live and is not a prototype:

- Shopify is the source of truth for orders, paid state, consent, fulfillment, and revenue.
- Cloudflare Worker `novahair-lifecycle-bridge` performs lifecycle state management, idempotency, Shopify polling/webhooks, event dispatch, and analytics aggregation.
- Cloudflare D1 `shopify-funnel-control-db` is the durable lifecycle ledger.
- Resend owns template rendering, delivery, and provider event generation.
- The deployed private app currently renders the dashboard at `/admin/lifecycle-analytics.html`, but this is an external Railway page, not an embedded Shopify Admin application.

The existing app was created as an Admin-created custom app. Shopify does not allow that app type to be embedded with App Bridge. A **new Custom Distribution app in the Shopify Dev Dashboard** is therefore required for the UI embedding only. Do not create a duplicate Worker, D1 database, Resend domain, automation, template, or lifecycle service.

## What is already in production

| Area | Production value | Team action |
|---|---|---|
| Lifecycle Worker | `https://novahair-lifecycle-bridge.tigerbrands-funnel.workers.dev` | Reuse as the single backend source. |
| D1 database | `shopify-funnel-control-db` | Do not query it from the application or browser. |
| Worker Cron | Every 10 minutes | Leave unchanged. |
| Sending domain | `email.tigerbrandsglobal.com` | Already verified. Do not edit DNS. |
| Tracking domain | `links.email.tigerbrandsglobal.com` | Already verified. Do not edit DNS. |
| Existing dashboard | `https://funnel-app-production-e22d.up.railway.app/admin/lifecycle-analytics.html` | Replace this access path with an embedded App Home experience. |
| Lifecycle flows | 6 flows / 39 emails | Use the catalog API; never hard-code the catalog in the frontend. |

Four flows are currently live: Abandoned Checkout, Welcome, Post-Purchase, and Replenishment/Winback. Browse and Abandoned Cart deliberately remain disabled until a reliable consented storefront identity design exists. Do not turn them on as part of this embedding work.

## Required end state

An authorized staff member opens **Apps → Funnel Control Internal → Lifecycle Analytics** in Shopify Admin and sees the existing Hebrew-first dashboard within Shopify.

The page must show:

1. Overview: delivery, open, click, Shopify revenue truth, first-party email-attributed revenue, flow state, health, and quota.
2. Flows: six lifecycle flows, their enabled/identity-gated state, triggers, exits, email steps, and Resend automation links.
3. Email library: all 39 emails, copy/metadata, Resend template links, and a per-email **Recipients and activity** drill-down.
4. Recipient drill-down: exact email address, sent, delivered, opened, clicked, and next scheduled email for that selected flow step. This is restricted PII and must be visible only to explicitly authorized lifecycle administrators.
5. Operations: private health, recent error summaries, webhook state, sync state, and free-plan usage alarms.

The dashboard must only read data. It must not expose a button that starts, replays, enables, disables, or re-provisions lifecycle automation resources.

## Architecture to preserve

```text
Shopify Admin embedded app (browser)
  -> short-lived Shopify ID token on every same-origin API call
  -> Railway application backend
  -> server-only bearer token
  -> Cloudflare Lifecycle Worker
  -> D1 and Resend/Shopify integrations
```

There is no valid browser-to-Worker, browser-to-D1, or browser-to-Resend path. `LIFECYCLE_ADMIN_TOKEN` is a server-side secret used only by the Railway application backend when it calls the Worker.

## Existing code to reuse

| Concern | Repository path |
|---|---|
| Lifecycle dashboard HTML | `app/admin/lifecycle-analytics.html` |
| Dashboard UI and recipient drill-down | `app/admin/js/lifecycle-analytics.js` |
| Browser API helper | `app/admin/js/api.js` |
| Server-side Worker proxy | `app/src/routes/lifecycle-admin.ts` |
| App Bridge HTML injection and CSP | `app/src/server.ts` |
| Current Shopify token verification | `app/src/middleware/shopify-auth.ts` |
| App config template | `app/shopify.app.toml` |
| Worker source and migrations | `services/novahair-lifecycle-bridge/` |
| Full lifecycle engineering reference | `services/novahair-lifecycle-bridge/HANDOFF.md` |
| Analytics API reference | `services/novahair-lifecycle-bridge/ANALYTICS-INTEGRATION.md` |
| Production resource and test record | `services/novahair-lifecycle-bridge/PRODUCTION-READINESS-REPORT.md` |

The existing static page includes the public App Bridge client ID placeholder and the server has a valid `frame-ancestors` policy. That is preparation only. The current browser helper uses ordinary `fetch`, so it does **not yet** send Shopify ID tokens; it must be upgraded before `SHOPIFY_REQUIRE_AUTH=true` can be enabled.

## Implementation plan

### 1. Create the embedded app record

In Shopify Dev Dashboard, create a **Custom Distribution** application for the one NovaHair store. Use Custom Distribution, not a public App Store app and not an Admin-created app.

Configure the app with:

- App name: `Funnel Control Internal`
- App URL: the final public Railway HTTPS origin
- Embedded: enabled
- Allowed redirection URLs: the app's required HTTPS callback URLs, if the selected Shopify setup requires them
- API version: `2026-07` unless the team deliberately upgrades all related integration code together
- Scopes: start from `app/shopify.app.toml`; request only scopes actually used by the Funnel Control app
- App Proxy: `/apps/funnels` only if the existing storefront tracking functionality is being enabled; it is not required merely to display lifecycle analytics

Update the placeholder values in `app/shopify.app.toml` with the actual Dev Dashboard client ID and final public HTTPS host. Do not put a client secret in this file.

Install the resulting Custom Distribution app in the NovaHair store. The old Admin-created app may remain only while needed for existing server-only integrations; do not revoke it until the team confirms what still depends on it.

### 2. Set host secrets and production flags

Set these values only in Railway's production secret manager (names shown; never commit values):

```text
APP_URL
SHOP_DOMAIN
ALLOWED_SHOP_DOMAIN
SHOPIFY_DISTRIBUTION=custom
SHOPIFY_CLIENT_ID
SHOPIFY_CLIENT_SECRET
SHOPIFY_API_VERSION=2026-07
SHOPIFY_SCOPES
SHOPIFY_LIVE_CONNECT=true
SHOPIFY_REQUIRE_AUTH=true
LIFECYCLE_WORKER_URL=https://novahair-lifecycle-bridge.tigerbrands-funnel.workers.dev
LIFECYCLE_ADMIN_TOKEN
DATABASE_URL
```

Do not set, log, or return the Worker secrets (`RESEND_API_KEY`, D1 encryption keys, Shopify webhook secret, Worker admin token) anywhere in the browser. The application needs only its own Shopify client credentials and the single server-to-server `LIFECYCLE_ADMIN_TOKEN`.

Railway Basic Auth on the current external page must not block Shopify's iframe/application bootstrap. Replace it with the embedded Shopify ID-token validation below for `/api/*`, retaining a narrowly scoped operational access policy for any external operations route. Do not make the analytics APIs public just to bypass the iframe issue.

### 3. Upgrade browser authentication

Update `app/admin/js/api.js` so every `/api/*` request obtains a fresh Shopify ID token from App Bridge and sends it in `Authorization: Bearer <ID_TOKEN>`. Do this immediately before every request; tokens are short-lived and must not be stored in local storage, cookies, or memory as a long-lived credential.

Conceptually:

```js
async function shopifyAuthorizedFetch(path, options = {}) {
  const token = await window.shopify.idToken();
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(path, { ...options, headers });
}
```

Use the actual App Bridge API available in the selected integration version. If the project remains on a manual integration, test that `window.shopify.idToken()` is available inside App Home. Prefer Shopify's maintained server libraries for token verification/exchange when practical, rather than expanding custom JWT code.

The backend already validates signature, expiry, audience, and allowed shop domain in `app/src/middleware/shopify-auth.ts`. Keep those checks. The backend must also reject a request when the token's shop does not equal the configured NovaHair shop.

### 4. Add explicit PII authorization

The standard analytics endpoints can be available to the internal app's authorized staff. The recipient endpoint returns customer email addresses and individual engagement timestamps, so it needs an additional authorization decision before it is forwarded.

Apply an explicit server-side role/allowlist policy to:

```text
GET /api/lifecycle/admin/audience
```

Recommended implementation: store permitted Shopify staff user IDs in the application's server-side database or an encrypted deployment secret, compare them with the verified ID token `sub`, and return `403` for everyone else. Do not rely on a hidden UI element, frontend role check, or the presence of an app session alone.

The endpoint supports:

```text
GET /api/lifecycle/admin/audience?flow=<flow_key>&emailNumber=<integer>&limit=250&offset=0
```

The UI already implements pagination. Keep `limit` bounded and do not add CSV export of customer email addresses without a separately approved privacy/access-control design.

### 5. Preserve server-side Worker proxying

`app/src/routes/lifecycle-admin.ts` already proxies the Worker safely. Retain its server-to-server pattern:

| App route | Worker route | PII returned |
|---|---|---|
| `GET /api/lifecycle/admin/flows` | `GET /api/lifecycle/admin/flows` | No customer PII |
| `GET /api/lifecycle/admin/analytics` | `GET /api/lifecycle/admin/analytics` | No customer PII |
| `GET /api/lifecycle/admin/health` | `GET /api/lifecycle/health` | No customer PII |
| `GET /api/lifecycle/admin/audience` | `GET /api/lifecycle/admin/audience` | Yes; additional role check required |

The Worker intentionally returns `404` for unauthenticated private routes. Preserve that behavior; do not translate it into a public discovery endpoint.

### 6. Make the embedded screen the entry point

After installation, navigate the app from Shopify Admin and direct the app home to `/admin/lifecycle-analytics.html` or provide a clear first navigation item named `Lifecycle Analytics`.

Keep Shopify's Admin frame; do not open the dashboard in a popup or force `top.location` navigation. Confirm that `Content-Security-Policy` allows only Shopify Admin frame ancestors, as in the existing server implementation. Do not send `X-Frame-Options: DENY` or `SAMEORIGIN` for the embedded page.

## Lifecycle API contract

The Worker catalog endpoint is the authority for flow labels, approved Hebrew copy, timing, automation/template IDs, and direct Resend URLs. The UI must not duplicate the 39-email catalog.

`GET /api/lifecycle/admin/analytics` accepts optional ISO timestamps:

```text
?from=2026-09-08T19:01:36.122Z&to=2026-10-08T19:01:36.122Z
```

Use the returned metrics at total, flow, and email levels. Revenue labels are non-negotiable:

- **Shopify revenue**: final order and revenue truth in the selected range.
- **Email-attributed revenue, 30-day last click**: observational first-party attribution, using exact checkout matching when available and email-hash fallback when it is not.
- Never call either number “incremental revenue” or say that email caused the revenue.

An open must never be used as an attribution signal. Mail privacy systems can prefetch pixels. A recipient can be considered a clicker only from a Resend click webhook and/or the first-party opaque redirect click event.

## Invariants the application must not break

1. A purchase stops remaining first-purchase Browse, Cart, Checkout, and Welcome sales messages.
2. Checkout recovery is keyed by the Shopify checkout ID, not by email address. The same email can have two independent checkouts.
3. Recovery URLs and checkout recovery tokens never enter analytics payloads, application logs, browser code, or public URLs.
4. No email/name/phone/recovery secret appears in UTM values. Commercial links use the existing flow/email UTM standard.
5. Unsubscribed, complained, hard-bounced, or suppressed contacts do not receive later marketing sends.
6. Browse and Cart must remain identity-gated. Do not manufacture identity or add intrusive checkout JavaScript.
7. Post-Purchase E03 through E07 are anchored to confirmed delivery state, not an estimated shipping date. The production schedule is delivery-aware.
8. Do not directly mutate Resend automations, templates, D1 data, or Worker resource state from this UI.

## Verification and acceptance checklist

The team should complete all items in a staging/safe deployment before making the embedded UI the normal entry point.

- [ ] New Custom Distribution app is installed in the correct NovaHair Shopify store.
- [ ] App opens inside Shopify Admin without browser Basic Auth or a cross-origin frame error.
- [ ] A fresh Shopify ID token is attached to every same-origin `/api/*` request.
- [ ] Missing, expired, forged, wrong-audience, and wrong-shop tokens get `401`; they cannot read lifecycle data.
- [ ] Server-side Worker proxy works with `LIFECYCLE_ADMIN_TOKEN`; the browser network panel never contains that token.
- [ ] `flows`, `analytics`, and `health` load inside Shopify and show 6 flows / 39 emails.
- [ ] Only explicitly allowlisted lifecycle admins can open recipient activity; a non-allowlisted staff member gets `403` and sees no customer email addresses.
- [ ] A selected email opens its recipient activity modal with sent/delivered/opened/clicked timestamps and pagination.
- [ ] External direct Worker admin routes still return `404` without the Worker bearer credential.
- [ ] The dashboard labels revenue correctly and does not claim incremental revenue.
- [ ] Browse/Cart remain visibly disabled with `Waiting for reliable consented identity`.
- [ ] Existing production email sending, Worker Cron, webhooks, Resend automations, and D1 migrations are unchanged and still healthy after app deployment.

## Deployment order and rollback

1. Create and install the Custom Distribution app in Shopify Dev Dashboard.
2. Configure Railway secrets and app configuration.
3. Deploy the browser ID-token change and recipient PII role check with `SHOPIFY_REQUIRE_AUTH=false` only in a non-production test environment.
4. Verify all acceptance criteria in Shopify Admin.
5. Deploy the same build to Railway production, set `SHOPIFY_REQUIRE_AUTH=true`, and validate an authorized and unauthorized user.
6. Change the normal internal bookmark/link to the Shopify Admin app entry point.

Rollback of the UI embedding is safe: set the app route back to the existing protected external portal or disable the Custom Distribution app. Do not disable the Worker, delete D1 state, rotate secrets, or touch Resend automations as a UI rollback action.

## Useful links

- [Shopify embedded app authentication with ID tokens](https://shopify.dev/docs/apps/build/authentication-authorization/id-tokens)
- [Shopify custom distribution](https://shopify.dev/docs/apps/launch/distribution/select-distribution-method)
- [Lifecycle source directory](./services/novahair-lifecycle-bridge/)
- [Full lifecycle engineering handoff](./services/novahair-lifecycle-bridge/HANDOFF.md)
- [Analytics endpoint contract](./services/novahair-lifecycle-bridge/ANALYTICS-INTEGRATION.md)
- [Production readiness report](./services/novahair-lifecycle-bridge/PRODUCTION-READINESS-REPORT.md)

