# Commerce OS knowledge base

This directory is the repository-safe source of truth for how Funnel Builder behaves.
It is written for owners, developers, and agents. Keep it current in the same Git
checkpoint as every behavior change.

## Read this first

1. `COMMERCE_OS_EXECUTION_STATUS.md` — what is live, verified, incomplete, or blocked.
2. `EVENT_REGISTRY.md` — canonical event names, owners, identifiers, and reporting use.
3. `IDENTITY_AND_ATTRIBUTION_CONTRACT.md` — how a visit becomes a verified Shopify sale.
4. `ORDER_ATTRIBUTION_RUNBOOK.md` — paid-order release and incident procedure.
5. `SUPPORT_DELIVERY_RUNBOOK.md` — support mailbox, AI safety, send, and delivery evidence.
6. `SHIPMENT_CONTROL_RUNBOOK.md` — reconciled Shopify/CJ risk, action queue, and approval boundaries.

## Non-negotiable contracts

- Shopify is authoritative for paid orders and commercial value.
- Browser events describe behavior; they never manufacture revenue.
- Anonymous visitors, carts, checkouts, orders, experiments, and support customers use
  separate identifiers and are joined only through explicit evidence.
- Event writes are idempotent. Every source supplies a stable event key or event ID.
- Internal, QA, canary, and theme-editor activity is excluded from production reporting.
- Customer email, phone, message bodies, access tokens, and credentials never belong in
  Git history or owner-facing analytics labels.
- Owner-facing screens use plain English. Raw identifiers remain available only for
  diagnostic drill-down.
- Support automation may answer only policy-approved low-risk requests with sufficient
  confidence and verified facts. High-risk or uncertain cases escalate.

## Change procedure

For every meaningful checkpoint:

1. Work from a clean isolated branch or worktree.
2. Read the current contract and the affected runtime before editing.
3. Add or update tests for the behavior and its failure mode.
4. Update the relevant knowledge-base document in the same commit.
5. Run tests and type-checks.
6. Commit and push before production deployment.
7. Deploy the smallest affected surface.
8. Verify production with aggregate or synthetic-safe evidence; never expose customer PII.
9. Record the verified state in `COMMERCE_OS_EXECUTION_STATUS.md`.

## Current product areas

| Area | Route | Authoritative data |
| --- | --- | --- |
| Overview | `/admin/index.html` | Aggregated verified subsystem data |
| Insights | `/admin/growth-cockpit.html` | Shopify finance plus connected acquisition sources |
| Journeys | `/admin/journeys.html` | Shopify paid orders joined to first-party identity evidence |
| Experiences | `/admin/ai-concierge.html` | On-site assistant events and Shopify-attributed outcomes |
| Experiments | `/admin/element-experiments.html` | Deterministic assignments and Shopify-paid-order outcomes |
| Support | `/admin/support.html` | Namecheap mailbox, Shopify order context, AI decisions, delivery evidence |
| Operations | `/admin/operations.html` | Cross-system health and verified incident queue |
| Shipment Control | `/admin/shipment-control.html` | Shopify payment/risk plus authenticated CJ order and tracking evidence |


## Documentation safety

Examples must be synthetic and sanitized. Environment variable names may be documented;
their values may not. If source and documentation disagree, the runtime plus tests win
temporarily, and the documentation must be corrected in the same checkpoint.
