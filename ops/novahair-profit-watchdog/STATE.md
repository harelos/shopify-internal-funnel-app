# NovaHair Watchdog State

Last reconciled: 2026-08-24T15:52:51Z  
Meta account timezone: Asia/Jerusalem  
Currency: USD  
Mode: **READ/WRITE AVAILABLE; CURRENT DECISION HOLD**

## Current delivery structure

Campaign `120248307316790135` — `TEST | NovaHair | ABO | Direct Offer vs VSL | IL` — ACTIVE, ABO, Sales.

| Ad set | ID | Effective status | Daily budget | Learning |
|---|---:|---|---:|---|
| Direct Offer Statics | `120248307317390135` | ACTIVE | $24 | Yes |
| VSL Advertorial Controls / 7 Reasons | `120248307320940135` | ACTIVE | $5 | Yes |

Active ads:

- `120248307353480135` — Salon Cost / Direct Offer
- `120248307355020135` — 4-Pack Offer / Direct Offer
- `120248307355510135` — Nova-v1 / 7 Reasons
- `120248325512560135` — Salon Cost / 7 Reasons

Recently paused ads:

- `120248307354150135` — Natural Result / Direct Offer, paused 2026-08-24 07:23 Israel
- `120248307356170135` — Nova-v2 / 7 Reasons, paused 2026-08-24 07:43 Israel

Recent human/account edits detected: Direct Offer budget changed to $24/day at 13:09 Israel; VSL budget changed to $5/day at 07:43; two ads were paused and Salon Cost / 7 Reasons was created this morning. Multiple-agent protection is active.

## Reconciled economics

Test lifetime, 2026-08-22 through 2026-08-24:

- Shopify real orders: 8; revenue $593.91; refunds $0; AOV $74.24
- New customers: 7; returning customers: 1
- Strict paid-UTM orders: 7, all new; Shopify revenue $513.91
- Active-test Meta spend: $48.60; Meta purchases: 7; Meta purchase value: $523.06
- Paid CPA and new-customer CAC: $6.94
- Verified quoted main-bundle CJ product + shipping: $226.62 for the seven strict paid orders
- Payment fees: **UNKNOWN**
- Add-on product and incremental shipping cost on one order: **UNKNOWN**
- Actual charged CJ fulfillment cost: **UNKNOWN** because orders remain unfulfilled
- Break-even CPA: actual **UNKNOWN**; provisional upper bound $41.04 before payment fees and unknown add-on costs
- Contribution profit: actual **UNKNOWN**; provisional upper bound $238.69 before payment fees and unknown add-on costs
- Contribution margin: actual **UNKNOWN**; provisional upper bound 46.45%

Do not present the upper bounds as final profit or final break-even CPA.

## Windows

| Window | Shopify truth | Meta truth | Economic status |
|---|---|---|---|
| Today | 4 real paid orders, $290.65, $0 refunds | $14.23 spend, 3 purchases, $221.79 value | Upper-bound contribution $151.58 before fees/add-ons; Shopify/Meta count mismatch |
| Trailing 24h | 5 real paid orders, $353.91 | Exact hourly spend unavailable from current connectors | Profit UNKNOWN |
| Trailing 3d | 8 real orders, $593.91 | $49.62 total account spend; 7 purchases in active test | Upper-bound contribution $278.31 before fees/add-ons |
| Trailing 7d | 8 known real orders, $593.91; test orders excluded | $59.31 account spend | Upper-bound contribution $268.62 before fees/add-ons |
| Active-test lifetime | 7 strict paid-UTM new orders, $513.91 | $48.60 spend, 7 purchases | Upper-bound contribution $238.69 before fees/add-ons |

## Active-test funnel

- Impressions 2,605; all-click CTR 4.57%; link CTR 2.99%; all-click CPC $0.41; CPM $18.66
- Link clicks 78; landing-page views 72; LPV rate 92.31%
- Add to carts 24; ATC/LPV 33.33%
- Initiated checkouts 15; checkout/ATC 62.50%
- Purchases 7; purchase/LPV 9.72%; CPA $6.94; Meta ROAS 10.76

## Creative ranking

1. **Salon Cost / Direct Offer — strong winner:** $9.23 spend, 4 Meta purchases, $2.31 CPA, 13 LPVs, 6 ATCs, 4 checkouts; four strict Shopify orders, $274.18 revenue.
2. **4-Pack / Direct Offer — winner:** $13.81 spend, 2 purchases, $6.91 CPA, 17 LPVs, 9 ATCs, 7 checkouts; two strict Shopify orders, $159.84 revenue.
3. **Nova-v1 / 7 Reasons — promising learning route:** $14.57 spend, 1 purchase, $14.57 CPA, 28 LPVs, 6 ATCs, 4 checkouts; one strict Shopify order, $79.89 revenue.
4. **Nova-v2 / 7 Reasons — weak checkout progression, already paused:** $8.21 spend, 13 LPVs, 3 ATCs, 0 checkouts, 0 purchases.
5. **Natural Result / Direct Offer — insufficient sample, already paused:** $1.81 spend, 1 LPV, 0 purchases.
6. **Salon Cost / 7 Reasons — insufficient sample:** $0.97 spend, 12 impressions, no clicks.

## Unresolved anomalies and risks

1. All eight real paid orders are unfulfilled. The local CJ monitor reports no successful CJ sync, its worker lock points to a dead PID, and two supervisor processes are running. Do not trigger fulfillment without explicit authorization.
2. Shopify Payments transaction fees are inaccessible with current scopes, preventing final contribution-profit and break-even calculations.
3. One paid-UTM Shopify order today is absent from Meta's today purchase count. Lifetime totals happen to match because a separate Facebook-referrer order has no paid UTMs; attribution cohorts do not reconcile one-to-one.
4. Shopify analytics contains internal/test orders that must always be excluded: tagged bootstrap/canary orders and the owner's heavily discounted test order.
5. Local legacy scripts contain hardcoded connector credentials and disable TLS verification. Rotate/migrate secrets before those scripts are reused.

## Decision and next thresholds

**HOLD.** No Meta change executed. The live ad sets are in learning, economics are strong, samples are still small, and important edits were made by another operator today.

Next cycle:

- Reconcile new Shopify orders and refunds before interpreting Meta purchases.
- Check whether fulfillment begins and replace quote-model CJ costs with charged costs.
- Recalculate break-even CPA after payment fees and add-on costs become available.
- Protect Salon Cost and 4-Pack from premature pausing.
- Let Salon Cost / 7 Reasons accumulate meaningful click/LPV data before judging it.
- The four-hour minimum interval after the 13:09 Israel budget increase has elapsed. This only permits reassessment; it is not a reason to scale. Require fresh economics and a pre-write reread.
