# Phase 0 — Architecture Proposal

Status: proposal only. No Shopify app, credentials, store connection, theme change, or deployment has been created.

## Product boundary

This is a private, one-store funnel workspace that replaces the owner's essential Funnelish-style workflow: authored storefront steps, versioned variants, deterministic experiments, Shopify checkout handoff, and attributable reporting. It is not a public SaaS or a drag-and-drop page builder.

The product owns the pre-checkout experience and measures the Shopify checkout boundary. It does not replace, alter, or A/B-test Shopify checkout on Basic.

## Verified Shopify delivery model

Use a **custom-distribution app** created in Shopify Dev Dashboard and installed only on the allowed owner store. It can be embedded and can ship app extensions. This is deliberately not a merchant-created Shopify Admin custom app, because that distribution type cannot use App Bridge or app extensions.

The application will enforce `ALLOWED_SHOP_DOMAIN` in its authentication, webhook, and storefront request paths. Installation and connection to any other shop will be rejected. No App Store listing, billing API, live-store install, or deployment is in scope without written owner approval.

Official references:

- https://shopify.dev/docs/apps/launch/distribution
- https://shopify.dev/docs/apps/build/online-store/app-proxies
- https://shopify.dev/docs/apps/build/marketing/pixels
- https://shopify.dev/docs/apps/build/checkout/technologies

## Chosen architecture

| Area | Decision | Why |
| --- | --- | --- |
| App | TypeScript/Node app generated with the current Shopify CLI React Router template, Shopify App Bridge, and Admin GraphQL API | Officially-supported embedded-admin path and maintainable single-language stack. |
| Distribution | Dev Dashboard custom distribution, one-store allowlist | Private, installable on only the intended store, yet supports extensions. |
| Persistence | PostgreSQL + Prisma; local development may use a disposable local PostgreSQL instance | A durable relational store is the smallest sound choice for version history, deduplication, attribution, and reports. No Supabase or Firebase. |
| Admin UI | Embedded Polaris dashboard | Owner-facing workspace for funnels, versions, experiments, analytics, exports, and audit history. |
| Storefront pages | Shopify App Proxy at a stable funnel route, returning `application/liquid` when Liquid rendering is needed | Serves store-domain funnel URLs and lets Shopify render permitted Liquid in current theme context. |
| Theme integration | Small theme-app-extension loader/block only when page-wide route or contextual assets are needed | Avoids wholesale theme rewrites; versioned funnel content stays in the app. |
| Checkout | Native Shopify cart and `/checkout` handoff | Keeps payment, checkout security, and order creation in Shopify. |
| Tracking | Web Pixel app extension plus an app-proxy storefront event client | Pixel sees Shopify standard checkout events; the storefront client captures funnel-specific CTA/progression context. |
| Orders | `orders/paid` webhook reconciled to checkout token captured by the pixel | Web-pixel completion is useful but may not fire if the completion page does not load; paid order is the reporting authority. |

Initial Admin GraphQL access will be least-privilege and reviewed before implementation. Expected baseline: `read_orders` (and `read_all_orders` only if historical reporting beyond Shopify's default window is explicitly needed), `write_app_proxy`, `write_pixels`, and `read_customer_events`. Product/catalog read scopes are added only if imported content needs server-rendered catalog lookups. No protected customer-data scopes are required for the MVP because it stores no buyer PII.

## HTML import and serving contract

The owner pastes complete HTML into an immutable draft version. The original source is retained for authorized owner access, and a parser produces a portability report before it can be previewed or published.

| Input feature | Handling |
| --- | --- |
| Body markup and ordinary CSS | Preserve where possible, scope to the funnel shell, and serve through the approved proxy/Liquid surface. |
| Full document tags (`doctype`, `html`, `head`, `body`) | Extract metadata, styles, and body; they cannot be blindly placed inside a Shopify theme layout. |
| Liquid-safe dynamic content | Map explicit approved placeholders to Liquid or app-proxy data; validate Liquid syntax before publishing. |
| Product/cart CTA | Replace with explicit Shopify Ajax Cart / cart permalink behavior, then native `/checkout` handoff. Never collect payment data in the funnel. |
| Scripts, iframes, forms, third-party pixels | Flag and default to disabled until allowlisted. The dashboard preview runs in a sandboxed iframe; production only permits reviewed assets/scripts. |
| External assets | Report source URL and import status; owner decides whether to retain a permitted URL or move the asset to Shopify Files/theme assets. |
| Unsupported behavior | Clearly listed with a fallback, never silently changed. |

Publishing creates an immutable render artifact, tied to a version and audit entry. A version can be draft, previewable, published, archived, or restored as the active published version. Rollback only switches the published pointer; it never mutates historical content or events.

## Core data model

All IDs are UUIDs except Shopify global IDs/tokens. Timestamps are UTC. Visitor IDs are random pseudonymous first-party identifiers, not emails or customer records.

| Model | Key fields |
| --- | --- |
| `Shop` | `id`, `shop_domain` (unique), `installed_at`, `status` |
| `Funnel` | `id`, `shop_id`, `name`, `slug`, `status`, `archived_at` |
| `Step` | `id`, `funnel_id`, `position`, `kind` (`landing`, `advertorial`, `sales`, `offer`, `pre_checkout`, `checkout_handoff`), `status` |
| `Variant` | `id`, `step_id`, `name`, `status`, `published_version_id` |
| `ContentVersion` | `id`, `variant_id`, `revision`, `state`, `raw_html`, `normalized_html`, `liquid_template`, `portability_report_json`, `created_by`, `published_at`, `supersedes_id` |
| `Experiment` | `id`, `step_id`, `status`, `allocation_version`, `started_at`, `ended_at` |
| `ExperimentAllocation` | `experiment_id`, `variant_id`, `weight_basis_points`, unique per experiment/variant; weights must total 10,000 |
| `Visitor` | `id`, `shop_id`, `anonymous_key_hash`, `first_seen_at`, `consent_state` |
| `Assignment` | `id`, `visitor_id`, `experiment_id`, `variant_id`, `assignment_key`, `assigned_at`; unique (`visitor_id`, `experiment_id`) |
| `Event` | `id`, `shop_id`, `event_key` (unique), `occurred_at`, `received_at`, `source`, `name`, `visitor_id`, `funnel_id`, `step_id`, `variant_id`, `checkout_token`, `payload_json`, `is_test` |
| `CheckoutAttribution` | `shop_id`, `checkout_token` (unique), `visitor_id`, `funnel_id`, `last_step_id`, `last_variant_id`, `started_at`, `completed_at`, `attribution_confidence` |
| `OrderAttribution` | `shop_id`, `shopify_order_gid` (unique), `checkout_token`, `funnel_id`, `variant_id`, `currency`, `gross_amount`, `net_revenue_amount`, `status`, `attributed_at` |
| `AuditLog` | `id`, `actor`, `action`, `entity_type`, `entity_id`, `before_json`, `after_json`, `occurred_at` |
| `ReportExport` | `id`, `funnel_id`, `filters_json`, `format`, `storage_key`, `created_at`, `created_by` |

Raw browser/pixel payloads are minimized and retained only for a documented period. Reports use normalized event and attribution columns. Buyer email, phone, address, payment data, and full IP are neither required nor stored.

## Assignment and experiment rules

1. On entry to an experiment step, create/read one `Assignment` keyed by the pseudonymous visitor and experiment.
2. Deterministically choose the variant using a cryptographic hash of `visitor_key + experiment_id + allocation_version`, mapped to the configured basis-point ranges.
3. Persist the assignment before rendering; a cookie/local storage context is only a cache. Returning sessions use the database assignment and never move when weights change.
4. Allocation changes create a new allocation version and apply only to newly assigned visitors. Existing assignments remain fixed.
5. A paused, completed, or archived experiment serves its configured fallback/published variant without deleting any events.

## Event taxonomy and data-quality policy

All incoming events carry an idempotency key and source. Server receipt time and client occurrence time are kept separately. Counts default to a deduplicated visitor/assignment view where appropriate.

| Event | Source | Required context | Primary metric use |
| --- | --- | --- | --- |
| `funnel_step_entered` | App-proxy page client | funnel, step, variant, visitor, UTM snapshot, device class | unique visitors and step entry |
| `funnel_page_viewed` | App-proxy page client | above + render version | page views |
| `funnel_cta_clicked` | App-proxy page client | above + CTA ID + destination | CTA rate |
| `funnel_next_step_entered` | App-proxy page client | from/to step and variant | step conversion/drop-off |
| `cart_checkout_started` | Web Pixel | checkout token, visitor context when available, currency/value | checkout starts |
| `checkout_completed_observed` | Web Pixel | checkout token, order ID if present, total/currency | near-real-time completion signal |
| `shopify_order_paid` | verified Shopify webhook | order GID, checkout token, totals/currency | authoritative purchases/revenue |
| `shopify_order_cancelled_or_refunded` | verified Shopify webhook | order GID, monetary adjustment | revenue correction |

The web pixel subscribes only to the needed Shopify standard events (`page_viewed`, `checkout_started`, `checkout_completed`) rather than treating every pixel event as a business metric. Shopify's pixel event ID is the preferred dedupe key; webhook deliveries use the Shopify event/order identity. The order reconciliation key is `checkout_token`, not the removed checkout ID. Events without consent are not sent where Shopify's Customer Privacy API blocks pixel callbacks.

UTM fields (`source`, `medium`, `campaign`, `content`, `term`), referrer, landing path, and a coarse device class are captured on first funnel entry and kept as the attribution snapshot. The report exposes the selected attribution model (initial touch, last pre-checkout funnel touch, and the selected time window) rather than implying certainty.

## Shopify Basic limits and honest fallbacks

| Constraint | Product response |
| --- | --- |
| Checkout cannot be A/B-tested or structurally customized on Shopify Basic | Treat native checkout as the measurement boundary; test pre-checkout pages and hand off to the same Shopify checkout. |
| Checkout UI extensions are Shopify Plus for in-checkout UI | Mark any in-checkout placement unavailable on Basic and offer pre-checkout or post-purchase alternatives where supported. |
| Pixel events require customer consent in applicable regions and can be blocked or completion pages may not load | Show consent/coverage caveats; reconcile with paid-order webhooks and label observed versus authoritative values. |
| App proxy supplies one configured root and cannot set response cookies | Use one stable funnel proxy root; keep assignment server-side with a browser context cache. |
| HTML is not automatically portable to Shopify themes | Provide a portability report, explicit mappings, preview, and owner approval before publish. |
| Order attribution may be incomplete if checkout token/context is absent or buyer changes browser/device | Label attribution confidence and report unattributed paid orders separately. |
| Revenue changes after payment (refunds/cancellations) | Ingest verified Shopify lifecycle webhooks and present revenue definition/date filters. |

## Phase plan and acceptance gates

### Phase 1 — Product/design model

Create an original low-fidelity owner dashboard and an HTML wireframe preview for: funnel list, ordered steps, HTML/version editor and portability report, experiment allocation, analytics, and report export.

Acceptance:

- One clear workflow creates a funnel, adds ordered steps, creates a version, configures a non-hardcoded split, previews, and sees a report.
- The wireframe visibly distinguishes draft, preview, published, archived, and rollback actions.
- The design labels Basic checkout limits and attribution caveats.
- No Funnelish UI/assets/code is copied.

### Phase 2 — Minimal vertical slice

Scaffold the private app in this folder only. Implement a single funnel with one pre-checkout step, HTML import + sandbox preview + portability validation, one version lifecycle, two variants, stable assignment, event ingestion, and a synthetic test mode.

Acceptance:

- A visitor receives the same variant after refresh/new session context lookup.
- Event replay does not increase view, checkout, or order totals.
- Published content is immutable; rollback changes the active version without loss.
- Tests cover assignment stability, allocation math, event idempotency, progression, and checkout-token/order revenue attribution.
- Test data is visibly separated from production data.

### Phase 3 — Analytics and reporting

Add the dashboard, date/filter queries, CSV and JSON exports, and the narrowly required Shopify pixel/webhook integration.

Acceptance:

- Dashboard filters by funnel, step, variant, range, UTM/source, and device where available.
- It reports deduplicated visitors, views, CTA/step conversion, checkout starts, paid purchases, revenue, AOV where denominator is valid, and sample-size caveats.
- Export contains definitions, filters, attribution assumptions/confidence, and generated timestamp.
- The UI calls the export an analytics report, never a payment receipt; Shopify order data remains the payment source of truth.

## Owner decisions / credentials needed before Phase 1 or 2

1. Exact allowed shop domain and whether it is a development store first; explicit approval is needed before any real installation.
2. Preferred deployment host and managed PostgreSQL provider/owner account, or approval to choose one later. No production credentials should be pasted into source control or chat.
3. Whether the funnel must live under `/apps/...` initially (app proxy) or whether an existing theme URL/page structure must be preserved; provide one representative exported HTML page for the portability test.
4. Consent-management provider/regions served and desired data-retention window.
5. Revenue definition: gross paid, net of refunds, tax/shipping inclusion, currency handling, and attribution window.
6. Any existing analytics pixels that must coexist, to avoid duplicate events.

## Phase 0 results

- Workspace inspected: present and empty; no docs or assets supplied.
- Files created: this proposal only.
- Tests run: none; no executable application has been scaffolded.
- Functional deliverable: architecture and phase-gated acceptance plan only.
- Blockers: owner decisions above and Shopify credentials are intentionally not requested until the next authorized implementation phase.
- Next smallest task: Phase 1 low-fidelity dashboard/flow and acceptance checklist, after owner confirms the proposal or adjusts constraints.
