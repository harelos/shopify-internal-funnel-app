# Commerce OS execution status

This document is the repository-safe operating record for the Funnel Builder → Commerce OS consolidation. It records contracts, checkpoints, verification, and next work. It must never contain production secrets, customer email bodies, access tokens, or other customer PII.

## Product contract

- Shopify is authoritative for paid orders, refunds, cancellations, and net revenue.
- Asia/Jerusalem is the reporting calendar for owner-facing business views.
- Test, internal, canary, and theme-editor activity is excluded from production reporting.
- A/B results may use only verified paid-order attribution. Historical orders with no surviving checkout identity remain `UNATTRIBUTED`; they are never guessed into a variant.
- Exit popup and AI Concierge remain separate experiences. They can share orchestration and reporting, but one experience must not silently change the other.
- Support auto-send is limited to low-risk, policy-approved cases. Refunds, chargebacks, legal/medical issues, uncertain identity, hostile messages, and missing order facts require escalation.
- GitHub stores code, schemas, runbooks, and sanitized examples. Runtime secrets and customer data remain in their designated systems.

## Product navigation

| Product area | Current working route | Purpose |
| --- | --- | --- |
| Overview | `/admin/index.html` | Decision-ready revenue, experiment, Concierge, support, and system-health view |
| Insights | `/admin/growth-cockpit.html` | Revenue, acquisition, contribution, and operational analysis |
| Journeys | `/admin/journeys.html` | Human-readable order paths joined to first-party visits, experiments, checkout, and Shopify purchases |
| Experiences | `/admin/ai-concierge.html` | AI Concierge configuration and verified business impact |
| Experiments | `/admin/element-experiments.html` | Element tests, deterministic allocation, preflight, and Shopify-paid-order results |
| Support | `/admin/support.html` | AI support inbox, drafts, escalation, evidence, and agent health |
| Operations | `/admin/cart-offers.html` | Storefront offer operations; broader fulfillment and incident work remains ahead |

## Completed checkpoints

### 1. Authoritative order webhooks

- Restored `orders/paid` and `orders/updated` Shopify webhook subscriptions.
- Added the order-attribution production runbook.
- Released Shopify app version `funnel-builder-7`.
- Git commit: `a2d38ce`.

### 2. Order reconciliation fallback

- Added an Admin GraphQL reconciliation pass every five minutes.
- Reconciliation creates or updates the order ledger but never manufactures a duplicate purchase event.
- Richer existing attribution is preserved.
- Historical orders with no verified identity are recorded as `UNATTRIBUTED`.
- Verified on 2026-09-08: five paid Shopify revenue orders matched five paid ledger rows; three historical orders lacked surviving checkout identity and remained unattributed.
- Gallery test verified sales at checkpoint: control 1 order / ₪319.68, Variant B 1 order / ₪239.
- Git commit: `498489c`.

### 3. Unified operating overview

- Replaced the wrapped admin button wall with a responsive product shell and seven clear working destinations.
- Added live business metrics, experiment results, support state, Concierge state, and signal-integrity status.
- The dashboard reads financial outcomes from Shopify-backed order attribution and never promotes exposure into a sale.
- Added range controls aligned to the Asia/Jerusalem business calendar.
- Desktop and embedded-mobile QA are required before this checkpoint is marked released.

### 4. Customer journey ledger

- Added a paid-order-first journey view backed by Shopify revenue, first-party visitor events, checkout identity, and experiment assignments.
- Raw tracking names and visitor identifiers are translated into readable customer actions.
- Historical orders without a provable browser identity remain visible as revenue but are labeled `UNATTRIBUTED`.
- Journey queries are bounded to 90 days and 100 paid orders per request, with event caps to protect embedded-app performance.
- Desktop and embedded-mobile QA are required before this checkpoint is marked released.

### 5. Support delivery integrity

- The hosted Railway mailbox agent is connected, runs once per minute, and remains the only active sender.
- Outbound replies now distinguish SMTP acceptance, verified Namecheap Sent-folder evidence, queue state, and failure state.
- The agent reconciles earlier sent drafts by deterministic Message-ID without resending them.
- The Support workspace exposes queued, sent, failed, and delivery-authentication health in owner-readable language.
- A guarded retry is available for failed drafts; sent drafts are displayed as receipts instead of appearing to have no draft.
- The Support workspace is scoped to conversations with inbound customer activity, Hebrew or mixed-language service history, or verified Shopify-order context. Unrelated outbound operational mail remains preserved in the source mailbox but is not presented as customer support.
- Live DNS verification on 2026-09-08 found Namecheap MX and DKIM, DMARC monitoring, and a missing SPF record. DNS was not changed because all legitimate domain senders must be inventoried before a single consolidated SPF record is published.
- Operational details: `docs/SUPPORT_DELIVERY_RUNBOOK.md`.

## Current truth snapshot

Snapshot date: 2026-09-08.

- AI Concierge: engagement and saved leads are present, but verified attributed sales are zero.
- NovaHair gallery experiment: three verified attributed paid orders (control: one; Variant B: two); the sample is far too small to declare a winner.
- Six paid orders are visible in the current-day store revenue snapshot; three historical orders remain unattributed because the earlier webhook gap left no checkout identity that can be proven now.

## Next checkpoints

1. Inventory every legitimate sender for `tigerbrandsglobal.com`, publish one consolidated SPF record, and verify propagation before treating sender authentication as healthy.
2. Finish and release the unified shell, then apply it incrementally to existing modules without changing storefront runtimes.
3. Normalize owner-facing labels into plain English while preserving raw identifiers behind drill-down details.
4. Consolidate experience eligibility so Exit Popup and AI Concierge can be enabled per page without colliding.
5. Add bounce ingestion and delivery-failure alerts to the support automation layer.
6. Continue CJ feasibility work only from verified documentation and authenticated behavior; do not invent a connector when the account/API surface cannot support it.
7. Add operations health and incident timelines before public app-store hardening.
