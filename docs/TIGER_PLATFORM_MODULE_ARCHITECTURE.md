# TIGER Private App — Module Architecture (V1)

Status: feature-branch only. Do not deploy or merge until the production Cloudflare Worker/D1 source is synchronized back into Git and the PR gates pass.

## Product navigation

- Funnels
  - Builder
  - Funnel Analytics (existing conversion/path analytics)
- Profit OS
  - Overview
  - Profit
  - Marketing
  - Products
  - Orders
  - Customers
  - Recommendations
  - Data Health
- Bot
  - Builder
  - Rules / Knowledge
  - Install
  - Analytics
- Popups
  - Builder
  - Targeting
  - Experiments
  - Analytics

The global Profit OS must not replace or mix with detailed funnel-step analytics. Profit OS may show funnel summaries and allow filtering by funnel/landing page, but detailed step/drop-off reporting remains under each funnel.

## Runtime boundaries

### Admin UI
Shopify embedded admin app. No Liquid is required for the admin dashboard.

### Storefront runtime
Bot and popup storefront delivery should be implemented as a first-party runtime with one authoritative configuration source. Preferred delivery options, in priority order:

1. Existing funnel renderer injection for pages served by this app.
2. Shopify Theme App Extension app-embed block for theme pages.
3. App Proxy endpoint only where necessary for first-party telemetry/config retrieval.

Do not ship duplicate runtime loaders on the same page.

### Analytics backend
Authoritative production analytics runtime: Cloudflare Worker + D1 after current production source is synchronized into Git.

Sources:
- Shopify: revenue, orders, customers, discounts, refunds, transaction fee truth where available.
- CJ Dropshipping: order/product/shipping/actual payment cost truth.
- Meta: manual access-token flow with encrypted-at-rest token and missing-day backfill.
- Funnel telemetry: existing Event / CheckoutAttribution model.
- Bot telemetry: impression/open/message/cta/lead/conversion events.
- Popup telemetry: eligible/impression/open/close/cta/submit/conversion events.

## Analytics data-quality contract

Never render missing values as zero.

Allowed source-quality labels:
- ACTUAL
- CONFIRMED
- LIVE_QUOTE
- HISTORICAL_ESTIMATE
- MISSING

When a required input is missing, dependent profit metrics must be null / incomplete, not fabricated.

## Bot event contract (planned)

Common envelope:
- event_id (idempotency key)
- occurred_at
- shop_id
- visitor_id (pseudonymous)
- session_id
- funnel_id nullable
- step_id nullable
- bot_id
- bot_version
- event_name
- metadata JSON

Initial event names:
- bot_eligible
- bot_impression
- bot_open
- bot_message_user
- bot_message_bot
- bot_cta_click
- bot_lead_submit
- bot_conversion_attributed
- bot_error

Bot analytics KPIs:
- eligible visitors
- impressions
- open rate
- conversation start rate
- messages/session
- CTA rate
- lead rate
- assisted conversion rate
- assisted revenue
- error rate

## Popup event contract (planned)

Common envelope mirrors Bot.

Initial event names:
- popup_eligible
- popup_impression
- popup_close
- popup_cta_click
- popup_submit
- popup_conversion_attributed
- popup_error

Popup analytics KPIs:
- eligible visitors
- impressions
- impression rate
- close rate
- CTR
- submit rate
- conversion rate
- attributed revenue
- revenue / 1,000 impressions

## Safety / QA gates before merge

1. Production source-sync gate — prove Git contains the same Worker/D1 code currently deployed.
2. Secret scan — no Meta/CJ/Shopify secret may exist in tracked files or generated reports.
3. Build/typecheck.
4. Unit tests.
5. API contract tests.
6. Auth tests for embedded admin endpoints.
7. Webhook HMAC/idempotency tests.
8. Profit truth tests: refunds, fees, CJ actual payment, FX, Meta all-spend rule.
9. UI interaction tests for every tab/button/filter/date control.
10. Storefront runtime tests on isolated test pages only.
11. Regression tests for existing funnels.
12. Draft PR review before merge. No production deployment from this branch.
