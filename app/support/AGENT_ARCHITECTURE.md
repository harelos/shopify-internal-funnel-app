# Customer Support Agent Architecture

Status: staging architecture, no customer-facing send capability.

## Goal

Build a provider-independent customer-support agent inside the existing Shopify internal control room. The agent should understand the customer's intent, retrieve only the facts it needs, plan a safe resolution, draft a reply, and either prepare a low-risk informational response or escalate/propose a controlled action.

The architecture must work before an LLM API key exists. A deterministic provider, versioned knowledge layer and replay/simulation harness are first-class components.

## Core design

```text
CHANNELS
  email / Shopify chat / future WhatsApp or social
        |
        v
CONVERSATION KERNEL
  thread identity, customer identity, language, history
        |
        v
INTENT + SKILL ROUTER
  WISMO, returns, exchanges, cancellation, address change,
  damaged item, product usage, shade help, discount request, etc.
        |
        v
CONTEXT BROKER
  Shopify order/customer/product facts
  tracking facts
  versioned knowledge packs
  approved store policies
        |
        v
TRUTH LEDGER
  1. structured Shopify/store facts
  2. approved versioned internal knowledge
  3. deterministic business rules
  4. model prose
        |
        v
POLICY / AUTHORIZATION ENGINE
  AUTO_DRAFT | HUMAN_APPROVAL | HUMAN_ONLY | NO_REPLY
        |
        v
TOOL PLAN
  read tools may execute automatically
  write tools are proposals only until explicitly authorized
        |
        v
RESPONSE COMPOSER
  deterministic fallback today
  swappable LLM provider later
        |
        v
EVALUATOR + AUDIT LOG
  expected intent, facts used, tools planned, decision, draft,
  human correction, eventual outcome
```

## Truth rules

The language model is the last layer, never the source of commercial facts.

The system must never invent:

- prices
- shipping terms or delivery promises
- discounts or coupon codes
- guarantees
- inventory claims
- refund/return/exchange rules
- refund amounts
- order state
- tracking state
- customer private information
- internal margin, COGS or supplier costs

If a required fact is missing, the engine must do one of three things:

1. call an approved read tool,
2. ask the customer for the missing identifier/information, or
3. escalate.

## Common skill catalog

The staging catalog covers common ecommerce and beauty support patterns:

- Shipping / tracking (WISMO)
- Shipping policy
- Delivery issue / delivered-not-received / stalled tracking
- Cancel order
- Change order
- Change shipping address
- Return request
- Return status
- Exchange request
- Exchange status
- Refund request
- Refund status
- Damaged item
- Wrong or missing item
- Product usage
- General product question
- Product recommendation
- Shade/color recommendation
- Stock request
- Discount request
- Feedback
- Thank-you / no reply required
- Legal / chargeback escalation
- Unknown / other

Every skill owns:

- intent triggers
- required facts
- allowed tools
- risk level
- default decision
- escalation conditions
- draft strategy

A lightweight deterministic sentiment signal is also recorded for future routing/analytics. Sentiment never authorizes a refund, discount, order change or any other business action.

## Customer and Shopify context

The support agent must not load a broad copy of the Shopify customer database into model context.

Use progressive retrieval instead:

1. Resolve customer identity from the support thread email and/or order number.
2. Read a reduced order view.
3. Read fulfillment/tracking only if needed.
4. Read product facts only if the question is product-related.
5. Read minimal customer context only when it materially changes the resolution.
6. Do not persist broad Shopify customer profiles in the support database.

Current implementation has a reduced, read-only order lookup. `READ_SHOPIFY_CUSTOMER` remains deliberately separate and planned because it needs `read_customers` authorization and can expose additional protected customer data. If added, it must have its own disabled-by-default gate and minimum-field response shape.

## Versioned knowledge packs

Product instructions and store policies cannot live as unversioned prompt text.

The knowledge layer uses a typed pack with:

- `DRAFT`, `APPROVED`, `RETIRED` pack status
- explicit semantic/version identifier
- effective date
- source metadata for every fact
- individual fact state: `KNOWN` or `UNKNOWN`

Rules:

1. A `DRAFT` or `RETIRED` pack cannot answer customer facts.
2. A fact marked `KNOWN` must contain an explicit value and source.
3. An `UNKNOWN` fact stays unknown; neither rules nor a model may fill it from memory.
4. Product lookup uses approved exact keys/titles/aliases instead of fuzzy guessing.
5. The server chooses the pack path. The client/model cannot choose or self-approve a pack.
6. The safe repository template intentionally contains no real commercial claims.

Implemented read helpers:

- approved shipping/returns policy facts
- approved product facts
- approved usage instructions
- approved shade guidance

The context broker returns an evidence trail with pack id, version and source, or an explicit reason the fact was unavailable.

## Tool authorization classes

### Automatically callable read/internal tools

- `READ_SHOPIFY_ORDER`
- `READ_TRACKING`
- `READ_PRODUCT_FACTS`
- `READ_STORE_POLICY`
- `REQUEST_CUSTOMER_INFO`
- `ESCALATE_HUMAN`

`READ_RETURN_STATUS` is defined but remains planned until an authoritative returns/exchange status source is connected.

### Sensitive reads

- `READ_SHOPIFY_CUSTOMER`

Use only when needed and retrieve minimum fields. It remains planned and disabled until the Shopify scope/data requirements are intentionally approved.

### Proposal-only write tools

- `PROPOSE_CANCEL_ORDER`
- `PROPOSE_ADDRESS_CHANGE`
- `PROPOSE_ORDER_EDIT`
- `PROPOSE_RETURN`
- `PROPOSE_EXCHANGE`
- `PROPOSE_REFUND`
- `PROPOSE_RESHIP`

These names are deliberate: the agent can plan the action, but the current system cannot execute it.

### Discounts

The model never creates an offer. It may request `REQUEST_SERVER_OFFER`. A later server-side offer engine will own:

- customer eligibility
- margin/authorization guard
- exact discount value
- previous-offer history
- frequency limits
- product restrictions
- campaign/experiment attribution
- expiration
- coupon issuance

The agent receives only the authorized customer-facing result. It never sees COGS or contribution margin.

## Decision matrix

### AUTO_DRAFT

Safe informational cases when facts are available:

- order/tracking status
- shipping-policy questions
- product-use instructions
- product questions
- stock questions
- shade/product guidance
- refund status
- return/exchange status when an authoritative status source exists
- ordinary feedback acknowledgement

`AUTO_DRAFT` does **not** mean auto-send. Sending is a separate capability gate.

### HUMAN_APPROVAL

Cases that might change money, inventory or an order:

- cancellation
- address change
- order edit
- return request
- exchange request
- refund request
- damaged/wrong item resolution
- reship/replacement
- delivery exception
- discount request

### HUMAN_ONLY

- legal threats
- chargebacks
- unknown intents
- low-confidence/high-risk combinations
- policy conflicts
- ambiguous customer identity for a sensitive action

### NO_REPLY

- clear thank-you / acknowledgement where no response is needed

## Model/provider layer

Do not couple the support engine to one model vendor.

`SupportModelProvider` is the boundary. Providers may later include an approved external LLM, but orchestration, facts, authorization and tools remain server-side.

Current staging provider:

`DeterministicSupportProvider`

It needs no API key and only produces constrained drafts from explicit facts. This lets us test intent routing, fact requirements, Shopify lookup planning, escalation, authorization, missing-fact behavior and Hebrew reply structure before trusting or paying for a model.

## No-key simulation

`POST /api/support/agent/simulate` is staging-only. It can test the decision pipeline without a mailbox or model key.

Important: any `facts` submitted directly to this endpoint are **synthetic staging test input only**. A production support flow must obtain truth from server-side approved tools and knowledge packs, never from client-submitted facts.

When the knowledge gate is enabled, the simulation endpoint loads the server-selected knowledge pack, resolves only the facts required by the detected skill and returns the knowledge evidence trail.

Example synthetic request:

```json
{
  "message": "איפה ההזמנה שלי? יש מעקב?",
  "locale": "he",
  "facts": {
    "order": {
      "found": true,
      "orderName": "#TEST",
      "trackingAvailable": true,
      "trackingUrl": "https://example.invalid/tracking/test"
    }
  }
}
```

Expected invariants:

- intent = `shipping_status`
- decision = `AUTO_DRAFT`
- tool plan includes order/tracking reads
- truth source includes Shopify
- `sendAllowed = false`
- `shopifyMutationAllowed = false`

## Replay/evaluation architecture

`GET /api/support/agent/replay` runs a synthetic regression corpus with no mailbox and no LLM key.

The current suite has more than 20 cases covering low-risk informational requests, approval-required actions, high-risk escalation and no-reply behavior. Each case can assert:

- expected intent
- expected decision
- required tools
- forbidden draft patterns
- no-send invariant
- no-Shopify-mutation invariant

This is intentionally useful during development: the first expanded replay suite caught a real classification miss for a common delivered-but-not-received phrase. That was fixed before continuing.

When historical support data is available later, add anonymized/minimized cases to the same replay system rather than replacing the synthetic baseline.

Release metrics should eventually include:

- intent accuracy
- hallucinated-fact rate (target: zero)
- unsafe action proposal rate
- unnecessary escalation rate
- missing escalation rate
- draft acceptance/edit rate
- resolution rate by skill
- repeat-contact rate

## Shopify-native AI

Shopify's own support/AI features may be useful as an independent channel where available, but the internal architecture must not depend on them. The orchestration layer should stay provider- and channel-independent so email, future channels, Shopify reads, approval rules, testing and analytics behave consistently.

If a supported Shopify Inbox integration becomes appropriate later, implement it as another **channel adapter**, not as the core brain.

## Current build order

Completed in this staging branch:

1. Agent kernel and deterministic provider.
2. Intent/skill catalog and policy engine.
3. Read/proposal tool registry.
4. Read-only Shopify order context.
5. Versioned knowledge-pack contracts and fail-closed loader.
6. Product/policy knowledge read tools and context broker.
7. Synthetic no-key replay/evaluation harness.

Next:

1. Populate the first real store knowledge pack from authoritative store/Shopify sources, leaving uncertain facts `UNKNOWN`.
2. Add minimal Shopify customer context only if it improves support decisions enough to justify `read_customers` access.
3. Add anonymized historical replay cases when available.
4. Add a real model behind `SupportModelProvider`, still draft-only.
5. Build human approval UI/workflow for sensitive proposals.
6. Only after measured reliability, add a separately gated send capability for an explicit allowlist of low-risk informational skills.
7. Keep write actions separately authorized and server-controlled.

## Hard release invariant

For the current phase:

```text
sendAllowed = false
shopifyMutationAllowed = false
```

No model, prompt, channel or customer input can override these values.
