# Phase 2 — Local Vertical Slice Specification

Status: approved by Phase 2 start instruction  
Scope: local-only implementation; no Shopify authentication, store, app-proxy, theme, pixel, webhook subscription, or deployment.

## Functional requirements

- FR-2.1: The project MUST have a Shopify CLI-compatible app configuration and retain the current Shopify React Router package as the future embedded-app integration boundary.
- FR-2.2: The Prisma PostgreSQL schema MUST model shop, funnel, ordered step, variant, immutable content version, experiment allocation, visitor assignment, event, checkout attribution, and order attribution.
- FR-2.3: The local runtime MUST create, read, update, and archive one funnel and ordered pre-checkout steps without drag-and-drop.
- FR-2.4: HTML import MUST retain the raw source, report document extraction and unsafe constructs, and create a sandboxed preview that does not execute imported scripts.
- FR-2.5: A published content version MUST be immutable; a new draft revision is required for changes.
- FR-2.6: Variant allocation MUST accept basis-point weights totaling 10,000 and return a persisted deterministic assignment for the same visitor/experiment.
- FR-2.7: The event service MUST ingest step entry, CTA click, checkout start, and paid purchase events idempotently.
- FR-2.8: Revenue attribution MUST link a paid order to prior checkout context by checkout token; unmatched orders MUST remain unattributed.
- FR-2.9: The local dashboard MUST label all data as synthetic/local and reiterate that Shopify Basic checkout is not an experiment surface.

## API contract

```ts
POST /api/funnels                 // { name, slug } -> Funnel
GET  /api/funnels                 // Funnel[]
POST /api/funnels/:id/steps       // { name, kind } -> Step
PATCH /api/funnels/:id            // { name?, status? } -> Funnel
POST /api/import                  // { variantId, html } -> ContentVersion + PortabilityReport
PATCH /api/versions/:id           // { html } -> ContentVersion (draft only)
POST /api/versions/:id/publish    // -> ContentVersion (published)
POST /api/assignments             // { visitorKey, experimentId } -> Assignment
POST /api/events                  // SyntheticEventInput -> IngestResult
GET  /preview/:versionId          // sandboxed, sanitized preview document
```

## Acceptance criteria and test mapping

- AC-2.1 / FR-2.6: Same visitor and experiment return the same persisted variant even if later allocation weights change. `assignment.test.ts`
- AC-2.2 / FR-2.7: Replaying an event key does not create a second event. `events.test.ts`
- AC-2.3 / FR-2.7: CTA requires a recorded entry for the same visitor and step. `progression.test.ts`
- AC-2.4 / FR-2.8: A paid order with a known checkout token produces one order attribution and revenue; repeat order delivery does not increase it. `attribution.test.ts`
- AC-2.5 / FR-2.4/2.5: Imported scripts are reported/removed from preview and a published version cannot be updated. `html.test.ts`

## Explicit exclusions

- Shopify OAuth/session validation, Admin GraphQL queries, app proxy signing, web pixel extensions, real webhooks, and production PostgreSQL connection.
- Checkout UI changes or checkout A/B testing on Shopify Basic.
- Drag-and-drop editing, report export, PII, payment data, and deployment.
