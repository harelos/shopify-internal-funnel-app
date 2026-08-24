# Current status

Branch: `staging/support-agent-phase1`

The current focus is the reusable customer-support agent architecture. Mailbox plumbing remains available on the branch but is intentionally paused while the decision, knowledge, Shopify-read and evaluation layers are built and tested.

## Implemented

### Support-agent kernel

- Provider-independent support-agent engine.
- Hebrew/English deterministic fallback that requires no LLM API key.
- Intent/skill routing for common ecommerce support requests: WISMO, shipping policy, delivery exceptions, cancellation, order/address changes, returns/status, exchanges/status, refunds/status, damaged/wrong/missing items, product usage/questions/recommendations, shade guidance, stock, discounts, feedback/thanks, legal/chargeback and unknown requests.
- Deterministic sentiment signal for routing/analytics; sentiment never authorizes a business action.
- Policy decisions: `AUTO_DRAFT`, `HUMAN_APPROVAL`, `HUMAN_ONLY`, `NO_REPLY`.
- Explicit tool registry separating automatic read/internal tools from proposal-only writes.
- Hard truth hierarchy: Shopify/store facts -> approved versioned knowledge -> deterministic rules -> model prose.

### Versioned knowledge layer

- Typed knowledge-pack schema with `DRAFT`, `APPROVED`, and `RETIRED` states.
- Every individual fact is explicitly `KNOWN` or `UNKNOWN` and includes a source.
- Unapproved packs fail closed; `KNOWN` facts without values are rejected.
- Product matching is exact by approved key/title/alias; no fuzzy product guessing.
- Read helpers for shipping/returns policy, product facts, usage instructions and shade guidance.
- Safe empty template at `support/knowledge-packs/store.v1.template.json` with no invented commercial facts.
- Separate staging gate: `SUPPORT_KNOWLEDGE_ENABLED=true` plus server-only `SUPPORT_KNOWLEDGE_PACK_PATH`.

### Context broker

- Resolves knowledge only when the detected skill requires it.
- Returns evidence with pack id/version/source or an explicit reason the fact was unavailable.
- Product knowledge requires an explicit product key in staging simulation.
- Missing facts stay visible to the policy engine instead of being filled by model prose.

### Shopify context

- Read-only Shopify order context per support thread behind `SUPPORT_SHOPIFY_LOOKUP_ENABLED=true`.
- Order lookup derives customer email from the thread, requests only reduced order/payment/fulfillment/line-item/tracking fields and does not persist the Shopify payload.
- Minimal Shopify customer identity adapter is now implemented behind an additional `SUPPORT_SHOPIFY_CUSTOMER_LOOKUP_ENABLED=true` gate.
- Customer lookup requests only `id`, `firstName`, `lastName`, and `defaultEmailAddress.emailAddress`, requires an exact email match, and does not persist the result.
- It deliberately does **not** request phone, address, tags, spend, marketing, tax or broad profile data.
- The customer gate stays disabled by default and requires intentional Shopify `read_customers` authorization/protected-customer-data approval. `read_customers` has not been added automatically to the app scopes.

### Evaluation / no-key testing

- `/api/support/agent/simulate` runs the support pipeline without a mailbox or LLM key.
- With knowledge enabled, simulation loads the server-selected approved pack and returns the evidence trail.
- `/api/support/agent/replay` runs a synthetic common-request regression suite with more than 20 ecommerce/beauty cases.
- Tests assert intent, decision, required tools, no-send/no-mutation invariants and forbidden patterns such as invented discounts.
- The expanded replay suite caught a delivered-but-not-received phrasing gap during development; the detector was fixed before continuing.
- Separate tests validate the minimal Shopify customer gate, exact-email query construction and reduced customer response shape.

### Mailbox layer (implemented, currently paused)

- Fixture and Namecheap-compatible IMAPS sources.
- Explicit second IMAP gate.
- Read-only mailbox lock; no mark-as-read behavior.
- Bounded MIME ingestion with Hebrew/UTF-8 support and source-size limits.
- Thread reconstruction, deduplication and support dashboard.

## Current validation

Latest support-staging GitHub Actions validation passes dependency install, Prisma schema validation/generation, TypeScript build and the full unit-test suite, including knowledge, replay and customer-context tests.

The npm install step still reports three high-severity dependency advisories. They do not fail CI, but they must be audited before production.

## Hard boundary

Still intentionally impossible:

- SMTP/customer-facing send
- automatic customer replies
- automatic refunds/cancellations/address or order edits
- automatic returns/exchanges/reships/replacements
- model-created discounts/coupon codes
- Shopify mutations
- production enablement

Proposal tools may describe a future sensitive action, but `sendAllowed=false` and `shopifyMutationAllowed=false` remain hardcoded.

## Safe staging defaults

```text
SUPPORT_STAGING_ENABLED=true
SUPPORT_SYNC_SOURCE=fixture
SUPPORT_IMAP_READ_ENABLED=false
SUPPORT_SHOPIFY_LOOKUP_ENABLED=false
SUPPORT_SHOPIFY_CUSTOMER_LOOKUP_ENABLED=false
SUPPORT_KNOWLEDGE_ENABLED=false
```

To test a reviewed local knowledge pack later:

```text
SUPPORT_KNOWLEDGE_ENABLED=true
SUPPORT_KNOWLEDGE_PACK_PATH=<server-side path to reviewed pack>
```

Do not change a pack to `APPROVED` until every `KNOWN` commercial fact has been checked against an authoritative store source.

## Next safe slice

1. Populate the first real store knowledge pack from authoritative Shopify/store policy/product sources; leave uncertain fields `UNKNOWN`.
2. Expand replay with anonymized historical cases when available.
3. Add a real LLM implementation behind `SupportModelProvider`; keep it draft-only and compare it against the deterministic baseline.
4. Build a human-approval queue for proposal-only actions.
5. Audit the current dependency advisories before production.
6. Only after measured reliability consider a separately gated send capability for an explicit allowlist of low-risk informational skills.
