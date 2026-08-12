# Phase 3 — Local Analytics and Export Slice

Status: authorized local-only subset  
Scope: aggregate only the existing synthetic events and attribution records. Shopify pixel, webhook, order API, and deployment remain out of scope until owner credentials and a development store are explicitly approved.

## Requirements

- FR-3.1: The dashboard MUST aggregate synthetic events by funnel and distinguish observed checkout starts from paid-order-confirmed purchases/revenue.
- FR-3.2: Reports MUST state that the data set is `TEST` and must not mix it with any future production events.
- FR-3.3: Funnel report metrics MUST include unique step entry, CTA clicks, checkout starts, paid orders, attributed revenue, AOV when paid-order count is nonzero, and unattributed paid orders.
- FR-3.4: CSV and JSON exports MUST include the applied filter/data mode, metric definitions, and attribution caveat.
- FR-3.5: CSV fields MUST be escaped correctly and JSON MUST be valid.

## Acceptance tests

- AC-3.1: A synthetic entry/CTA/checkout/paid sequence produces one entry, one CTA, one checkout start, one paid order, revenue, and valid AOV. `analytics.test.ts`
- AC-3.2: A paid order with an unknown checkout token is counted as unattributed and does not increase funnel revenue. `analytics.test.ts`
- AC-3.3: JSON and CSV exports serialize the same aggregate report and identify the `TEST` data mode. `export.test.ts`

## Explicit exclusions

- Store credentials, Web Pixel or webhook registration, Admin API order queries, live analytics, reports from production data, PDF, and payment receipts.
