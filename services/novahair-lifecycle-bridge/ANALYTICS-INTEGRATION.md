# NovaHair Lifecycle Analytics — Application Integration

## What exists now

Resend already provides provider-level views inside each Automation and email, but it is not NovaHair's unified revenue source. The production Worker now provides one private API that joins:

- Resend delivery, open, click, failure, complaint, and suppression webhooks;
- D1 schedule, trigger, first-party click, lifecycle state, and resource records;
- Shopify completed orders, currency, and revenue truth;
- the approved six-flow / 39-email content catalog.

The application developer should build the visual dashboard on this API. No direct D1, Shopify, or Resend credentials belong in the browser.

Base URL:

```text
https://novahair-lifecycle-bridge.tigerbrands-funnel.workers.dev
```

## Authentication

All analytics routes require:

```text
Authorization: Bearer <LIFECYCLE_ADMIN_TOKEN>
```

The internal application backend must hold the token in its server-side secret manager, call the Worker server-to-server, and return only the payload needed by an already authenticated admin user. Never place this token in browser code, a `NEXT_PUBLIC_*` variable, local storage, Git, logs, screenshots, or query parameters.

Unauthorized requests intentionally return `404`, not `401`, to avoid advertising private endpoints.

## Endpoint 1: flow and email catalog

```text
GET /api/lifecycle/admin/flows
```

Purpose: render the Flows page and the “what is inside this email?” detail drawer. The response contains all six flows and 39 emails.

Important fields:

- flow: stable internal key
- name, trigger, exit, KPI
- status, automation ID, direct Resend automation URL
- planned email count
- each email's number, title, timing, offset, subject, preview, CTA, purpose, approved body copy
- `scheduleAnchor` (`purchase`, `delivered`, or `trigger`) so the UI can distinguish estimated delays from delivery-aware timing
- template alias, template ID, publication status, direct Resend template URL

Condensed response shape:

```json
{
  "ok": true,
  "generatedAt": "2026-09-08T19:59:30.000Z",
  "totalFlows": 6,
  "totalEmails": 39,
  "flows": [
    {
      "flow": "abandoned_checkout",
      "name": "ABANDONED CHECKOUT",
      "status": "enabled",
      "automationId": "...",
      "automationUrl": "https://resend.com/automations/...",
      "emails": [
        {
          "number": 1,
          "title": "...",
          "timing": "...",
          "offsetMinutes": 60,
          "scheduleAnchor": "trigger",
          "subject": "...",
          "preview": "...",
          "cta": "...",
          "purpose": "...",
          "body": ["..."],
          "templateAlias": "novahair_abandoned_checkout_e01",
          "templateId": "...",
          "templateStatus": "published",
          "templateUrl": "https://resend.com/templates/..."
        }
      ]
    }
  ]
}
```

The catalog is the source for UI labels and content inspection. Do not duplicate its copy in frontend constants.

## Endpoint 2: analytics

```text
GET /api/lifecycle/admin/analytics
GET /api/lifecycle/admin/analytics?from=2026-09-08T19:01:36.122Z&to=2026-10-08T19:01:36.122Z
```

`from` and `to` are ISO-8601 timestamps. The default starts at production activation or 30 days ago, whichever is later. The maximum range is 366 days. Invalid or reversed ranges return `400`.

Metrics are returned at total, flow, and email level:

- scheduled and triggered
- sent and delivered
- unique messages opened
- unique messages clicked according to Resend
- unique first-party redirect clicks
- failed and suppressed
- attributed orders and attributed revenue by currency
- delivery, open, provider click, first-party click, and attributed-order rates

Condensed response shape:

```json
{
  "ok": true,
  "period": {
    "from": "2026-09-08T19:01:36.122Z",
    "to": "2026-10-08T19:01:36.122Z",
    "attributionWindowDays": 30
  },
  "totals": {
    "shopifyOrders": 0,
    "shopifyRevenueByCurrency": {},
    "firstPartyAttributedOrders": 0,
    "firstPartyAttributedRevenueByCurrency": {},
    "unattributedShopifyOrders": 0
  },
  "flows": [
    {
      "flow": "abandoned_checkout",
      "name": "ABANDONED CHECKOUT",
      "status": "enabled",
      "automationId": "...",
      "automationUrl": "https://resend.com/automations/...",
      "metrics": {
        "sent": 0,
        "delivered": 0,
        "opened": 0,
        "providerClicked": 0,
        "firstPartyClicked": 0,
        "attributedOrders": 0,
        "attributedRevenueByCurrency": {},
        "deliveryRate": 0,
        "openRate": 0,
        "clickRate": 0,
        "firstPartyClickRate": 0,
        "attributedOrderRate": 0
      },
      "emails": [
        {
          "number": 1,
          "title": "...",
          "subject": "...",
          "timing": "...",
          "templateId": "...",
          "templateUrl": "https://resend.com/templates/...",
          "metrics": {}
        }
      ]
    }
  ],
  "attribution": {
    "shopifyRevenueTruth": true,
    "firstPartyModel": "last_click_30_days_exact_checkout_preferred",
    "resendAttributedRevenue": {
      "available": false,
      "reason": "Resend does not expose a supported per-flow revenue feed to this Worker."
    },
    "incrementalRevenueClaimed": false
  },
  "privacy": {
    "customerEmailReturned": false,
    "customerNameReturned": false,
    "recoveryUrlReturned": false,
    "customerEntityIdentifiersReturned": false,
    "resendResourceIdentifiersReturned": true
  }
}
```

## Endpoint 3: operational health

```text
GET /api/lifecycle/health
```

Use it for a private Operations tab or status banner. It includes Worker health, last Shopify sync/API success, last Resend event/webhook, tracked checkout counts, sends/recoveries in the last 24 hours, errors, dead/uncertain work, resource counts, webhook/domain state, and quota status. It returns no customer PII, full recovery URL, or secret.

## Required dashboard

### Overview

Show a date selector and cards for:

- Shopify orders and revenue by currency
- first-party attributed orders and revenue by currency
- delivered, opened, Resend-clicked, and first-party-clicked totals
- delivery, open, click, and attributed-order rates
- enabled / identity-gated flows
- current quota status and health status

Label revenue precisely:

- `Shopify revenue` — final store truth in the selected period
- `Email-attributed revenue (30-day last click)` — observational first-party attribution
- never label attributed revenue as `incremental revenue` or `revenue caused by email`

### Flows table

One row per flow:

- status
- emails in flow
- sent, delivered, open rate, click rate
- attributed orders and revenue by currency
- link to Resend Automation
- “View emails” action

Make the disabled Browse/Cart reason visible: `Waiting for reliable consented identity`.

### Flow detail

One row per email:

- number and title
- timing
- schedule anchor; Post-Purchase E03-E07 should be labeled relative to confirmed delivery, not order date
- subject
- template status
- sent, delivery rate, open rate, provider and first-party click rates
- attributed orders and revenue by currency
- “View content” drawer showing preview, CTA, purpose, and body copy
- direct link to the Resend template

### Operations

Show the PII-free health response, recent errors by code/severity, webhook status, last successful sync times, free-plan usage and warning thresholds. Do not display raw webhook payloads or customer identifiers.

## Attribution rules

Shopify orders are the final order/revenue truth. An order is attributed to the latest qualifying first-party email click in the preceding 30 days, preferring an exact Shopify checkout-ID match over a recipient-hash match. Each order is counted once.

Open rate is useful for diagnostics but is not a reliable purchase signal because mailbox privacy features can prefetch pixels. Revenue attribution never uses an open alone. Provider clicks and first-party redirect clicks are shown separately because scanners and privacy systems can affect provider click counts.

The system intentionally does not invent a Resend revenue figure. If Resend later exposes a supported conversion/revenue feed, add it as a third separately labeled series; do not overwrite Shopify truth or first-party attribution.

True incrementality requires a durable holdout/control cohort. The current API correctly reports `incrementalRevenueClaimed: false`.

## Refresh and caching

- Analytics changes when a signed Resend webhook, a first-party click, a Shopify webhook, or the overlapping Cron poll is processed.
- Poll the overview every 60–120 seconds while the page is visible; refresh on demand after that.
- Cache server-side for at most 30–60 seconds and key the cache by date range.
- Never cache the bearer credential or private response in a shared/public CDN cache.

## Developer acceptance checklist

1. Backend-only Worker requests; no admin token in browser bundles or network-visible query strings.
2. Existing application authentication/authorization guards every lifecycle page and proxy route.
3. Date ranges are sent as ISO-8601 UTC and capped at 366 days.
4. The UI handles multiple currencies without summing unlike currencies.
5. Zero-volume periods render as zero, not an error.
6. Every flow and all 39 emails appear from the catalog API.
7. Email detail shows approved copy and a working Resend template link.
8. Revenue labels preserve the attribution distinction above.
9. Disabled Browse/Cart are not presented as broken.
10. Health and quota problems are visible without exposing PII or secrets.

## Live verification

On 2026-09-08 both protected endpoints returned `200` from the live Worker using a server-side credential. The catalog returned 6 flows and 39 emails with the correct four-enabled/two-disabled state. The analytics response used the production activation cutoff, returned Shopify/first-party totals, and declared all PII/recovery fields absent. The same endpoints returned `404` without authorization.
