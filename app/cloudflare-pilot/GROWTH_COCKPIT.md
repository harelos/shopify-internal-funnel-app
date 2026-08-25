# Growth Cockpit

## Current implementation

The Growth Cockpit is an embedded admin dashboard in the deployed Cloudflare Worker source.

- Admin document: `/admin/growth-cockpit.html`
- Authenticated configuration: `GET /api/growth-cockpit/config`
- Authenticated financial contract: `GET /api/growth-cockpit/finance`
- Reporting timezone: `REPORTING_TIMEZONE`, default `Asia/Jerusalem`
- Reporting currency: `REPORTING_CURRENCY=USD`, based on the verified shop-money and Meta account currency artifacts
- Meta credential: `META_ACCESS_TOKEN`, stored only as a Cloudflare Worker secret
- Meta account: `META_AD_ACCOUNT_ID=act_8852331774866389`; the account ID is public configuration, not a credential

The API uses local calendar dates and returns a half-open UTC range: `from` is inclusive and `toExclusive` is exclusive.

## Comparison policy

- Yesterday compares with the preceding completed day.
- Last 7 days, last 30 days, and custom ranges compare with the immediately preceding equivalent number of calendar days.
- Today has no automatic comparison because it is incomplete.
- All-time has no equivalent prior period.
- A percentage or absolute change appears only when both periods are `ACTUAL` and use one currency.

## Financial source contract

| Metric | Current source | Quality rule |
| --- | --- | --- |
| Revenue | Shopify Admin `Order.netPaymentSet.shopMoney` | `ACTUAL` only for a complete, non-truncated query inside the default 60-day order-access window and in the configured reporting currency |
| Orders | Shopify orders with a positive net payment | Follows the revenue source quality |
| D1 order revenue | Shopify order webhooks persisted in `OrderAttribution` | `PARTIAL` until a Shopify reconciliation watermark proves coverage |
| CJ variable costs | D1 `FinancialLedgerEntry` rows written after CJ verification | `PARTIAL` because current CJ values are confirmed pre-payment estimates, not charged costs |
| Payment fees | Shopify `Order.transactions.fees` | `ACTUAL` only when successful SALE fee coverage is complete |
| Meta spend | Meta Insights API for the configured account | `ACTUAL` for a complete API response with idempotent daily D1 persistence and an exact-range coverage watermark |

`Order.netPaymentSet` is the amount received minus refunds. It includes collected tax and shipping and must not be labelled ShopifyQL net sales.

`META_ACCESS_TOKEN` is read only inside `src/lib/meta-ads.ts`; it is never returned by an API, placed in a URL, logged, or written to Git. Successful Meta reads persist daily rows and an exact-range reconciliation watermark in D1. Historical completeness still has to be verified against Meta before release sign-off.

## Financial ledger

Migration `0006_growth_cockpit_financial_ledger.sql` adds idempotent daily entries and range coverage records. Meta uses account/date keys, so refreshing the same range updates rather than duplicates spend. CJ uses the Shopify order ID, so repeat verification updates rather than duplicates the order cost. CJ rows remain `ESTIMATE` and the dashboard aggregates them as `PARTIAL`; they cannot unlock profit.

The existing Worker cron reconciles today's Meta spend and Shopify net payments. D1 range watermarks throttle external reads to at most once every 15 minutes even though the NovaHair monitor runs every minute. Shopify transaction fees receive their own coverage record only when successful SALE transactions return fee rows; an empty or incomplete fee response never becomes an authoritative zero.

## Popup funnel

The Cockpit reads the existing authenticated `/api/analytics/popup` contract for NovaHair popup events. It displays eligibility, views, email starts, submit attempts, confirmed leads, coupon reveals, continuation, popup-attributed orders/revenue, dismissals, failure categories, and device/page/source breakdowns. It does not create a second event-ingestion path.

## Profit formulas

- CM1 = revenue - CJ variable costs - payment fees
- CM2 = CM1 - Meta spend
- CM2 margin = CM2 / revenue
- Break-even CPA = CM1 / orders
- Break-even ROAS = revenue / CM1
- POAS = CM1 / Meta spend

CM1, CM2, and their derived metrics are returned only when every required input is `ACTUAL`, finite, and in one currency. `PARTIAL`, `ESTIMATE`, `MISSING`, or mixed-currency inputs return null profit metrics with explicit blockers.

## Access and release state

The financial API is protected by the existing Shopify App Bridge session-token middleware. The HTML shell is `noindex` and exposes no data without a valid session. A Cloudflare Access layer may still be added later if policy requires the shell itself to be edge-blocked.

No Meta or CJ credentials belong in source control. Existing local helper scripts containing credentials are not valid ingestion sources and must not be reused.
