# Current status

Branch: `staging/support-agent-phase1`

The current focus is the reusable customer-support agent architecture. Mailbox plumbing remains available on the branch but is intentionally paused while the decision, knowledge, Shopify-read and evaluation layers are built and tested.

## Implemented

### Support-agent kernel

- Provider-independent support-agent engine.
- Hebrew/English deterministic fallback that requires no LLM API key.
- Intent/skill routing for common ecommerce support requests, including:
  - shipping/tracking (WISMO)
  - shipping policy
  - delivery exceptions / delivered-not-received
  - cancellation
  - order/address changes
  - return request + return status
  - exchange request + exchange status
  - refund request + refund status
  - damaged / wrong / missing item
  - product usage/questions/recommendations
  - beauty shade guidance
  - stock questions
  - discount requests
  - feedback / thanks
  - legal/chargeback escalation
  - unknown requests
- Deterministic sentiment signal for routing/analytics; sentiment never authorizes a business action.
- Policy decisions: `AUTO_DRAFT`, `HUMAN_APPROVAL`, `HUMAN_ONLY`, `NO_REPLY`.
- Explicit tool registry separating automatic read/internal tools from proposal-only writes.
- Hard truth hierarchy: Shopify/store facts -> approved versioned knowledge -> deterministic rules -> model prose.

### Versioned knowledge layer

- Typed knowledge-pack schema with `DRAFT`, `APPROVED`, and `RETIRED` states.
- Every individual fact is explicitly `KNOWN` or `UNKNOWN` and includes a source.
- Unapproved packs fail closed.
- `KNOWN` facts without a value are rejected by validation.
- Product matching is exact by approved key/title/alias; the knowledge layer does not fuzzy-guess a product.
- Read helpers exist for shipping/returns policy, product facts, usage instructions and shade guidance.
- A safe template exists at `support/knowledge-packs/store.v1.template.json`; it intentionally contains no invented commercial facts.
- Separate staging gate: `SUPPORT_KNOWLEDGE_ENABLED=true` plus a server-only `SUPPORT_KNOWLEDGE_PACK_PATH`.

### Context broker

- Knowledge is resolved only when the detected skill requires it.
- Evidence records include pack id/version/source or an explicit reason a fact was unavailable.
- Product knowledge requires an explicit product key in staging simulations.
- Missing facts remain visible to the policy engine rather than being filled by model prose.

### Shopify context

- Read-only Shopify order context per support thread is available behind `SUPPORT_SHOPIFY_LOOKUP_ENABLED=true`.
- Lookup derives the customer email from the support thread, requests only a reduced order/payment/fulfillment/line-item/tracking shape, and does not persist the returned Shopify payload.
- `READ_SHOPIFY_CUSTOMER` is defined but deliberately remains planned. It should only be implemented with a separate gate, `read_customers` authorization, minimum fields and no broad customer-profile persistence.

### Evaluation / no-key testing

- `/api/support/agent/simulate` runs the support pipeline without a mailbox or LLM key.
- When the knowledge gate is enabled, simulation loads the server-side approved knowledge pack and returns its evidence trail.
- `/api/support/agent/replay` runs a synthetic common-request regression suite.
- Current replay corpus covers more than 20 ecommerce/beauty cases across informational, approval, escalation and no-reply paths.
- Tests assert expected intent, decision, required tools, no-send/no-mutation invariants and forbidden draft patterns such as invented discounts.
- The first replay run exposed a real intent-routing gap for the phrase "delivered but I did not receive it"; the detector was fixed and the next CI run passed.

### Mailbox layer (implemented, currently paused)

- Fixture and real Namecheap-compatible IMAPS sources.
- Explicit second IMAP gate.
- Read-only mailbox lock; no mark-as-read behavior.
- Bounded MIME ingestion with Hebrew/UTF-8 support and source-size limits.
- Thread reconstruction, deduplication and support dashboard.

## Current validation

Latest support-staging GitHub Actions validation passes:

- dependency install
- Prisma schema validation
- Prisma client generation
- TypeScript build
- full unit-test suite, including knowledge and replay tests

The npm install step still reports three high-severity dependency advisories. They do not currently fail CI, but they must be audited before a production release.

## Hard boundary

Still intentionally impossible in this phase:

- SMTP/customer-facing send
- automatic customer replies
- automatic refunds
- automatic cancellations
- automatic address/order edits
- automatic returns/exchanges
- automatic reships/replacements
- model-created discounts/coupon codes
- Shopify mutations
- production enablement

Proposal tools may describe a future sensitive action, but `sendAllowed=false` and `shopifyMutationAllowed=false` remain hardcoded in the agent result.

## Safe staging configuration

```text
SUPPORT_STAGING_ENABLED=true
SUPPORT_SYNC_SOURCE=fixture
SUPPORT_IMAP_READ_ENABLED=false
SUPPORT_SHOPIFY_LOOKUP_ENABLED=false
SUPPORT_KNOWLEDGE_ENABLED=false
```

To test a reviewed local knowledge pack later:

```text
SUPPORT_KNOWLEDGE_ENABLED=true
SUPPORT_KNOWLEDGE_PACK_PATH=<server-side path to reviewed pack>
```

Do not change a pack to `APPROVED` until every `KNOWN` commercial fact in it has been checked against an authoritative store source.

## Next safe slice

1. Populate the first real store knowledge pack from authoritative Shopify/store policy/product sources; leave uncertain fields `UNKNOWN`.
2. Add the optional minimal Shopify customer-context adapter behind its own disabled gate if customer context materially improves resolution.
3. Expand the replay corpus with anonymized historical cases when available.
4. Add a real LLM implementation behind `SupportModelProvider`; keep it draft-only and compare it against the deterministic baseline.
5. Build a human-approval queue for proposal-only actions.
6. Only after measured reliability consider a separately gated send capability for a small allowlist of low-risk informational skills.
