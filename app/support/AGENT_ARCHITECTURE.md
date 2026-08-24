# Customer Support Agent Architecture

Status: staging architecture, no customer-facing send capability.

## Goal

Build a provider-independent customer-support agent inside the existing Shopify internal control room. The agent should understand the customer's intent, retrieve only the facts it needs, plan a safe resolution, draft a reply, and either resolve a low-risk informational case or escalate/propose a controlled action.

The architecture must work before an LLM API key exists. A deterministic provider and replay/simulation harness are therefore first-class components, not temporary hacks.

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
  WISMO, returns, cancellation, address change, damaged item,
  product usage, shade help, discount request, etc.
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
  2. versioned internal knowledge
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
- refund rules
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

Initial skills are based on common ecommerce support patterns and the needs of a beauty store:

- Shipping / tracking (WISMO)
- Shipping policy
- Delivery issue / delivered-not-received / stalled tracking
- Cancel order
- Change order
- Change shipping address
- Return request
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
- Thank-you / no reply required
- Legal / chargeback escalation
- Unknown / other

Every skill contains:

- intent triggers
- required facts
- allowed tools
- risk level
- default decision
- escalation conditions
- draft strategy

## Customer and Shopify context

The support agent should not load a broad copy of the Shopify customer database into its prompt.

Use progressive retrieval instead:

1. Resolve customer identity from the support thread email and/or order number.
2. Read a reduced order view.
3. Read fulfillment/tracking only if needed.
4. Read product facts only if the question is product-related.
5. Read minimal customer context only when it materially changes the resolution.
6. Do not persist broad Shopify customer profiles in the support database.

Current implementation already has a reduced, read-only order lookup. `READ_SHOPIFY_CUSTOMER` is intentionally a separate planned capability because it can expose additional customer data and should use the minimum fields necessary.

## Tool authorization classes

### Automatically callable read/internal tools

- READ_SHOPIFY_ORDER
- READ_TRACKING
- READ_PRODUCT_FACTS (once implemented)
- READ_STORE_POLICY (once implemented)
- REQUEST_CUSTOMER_INFO
- ESCALATE_HUMAN

### Sensitive reads

- READ_SHOPIFY_CUSTOMER

Use only when needed and retrieve minimum fields.

### Proposal-only write tools

- PROPOSE_CANCEL_ORDER
- PROPOSE_ADDRESS_CHANGE
- PROPOSE_ORDER_EDIT
- PROPOSE_RETURN
- PROPOSE_REFUND
- PROPOSE_RESHIP

These names are deliberate: the agent can plan the action, but the Phase 1/2 system cannot execute it.

### Discounts

The model never creates an offer. It may call `REQUEST_SERVER_OFFER`. A later server-side offer engine will own:

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

AUTO_DRAFT does **not** mean auto-send. Sending is a separate capability gate.

### HUMAN_APPROVAL

Cases that might change money, inventory or an order:

- cancellation
- address change
- order edit
- return/refund request
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

It needs no API key and only produces constrained drafts from explicit facts. This lets us test:

- intent routing
- fact requirements
- Shopify lookup planning
- escalation
- action authorization
- missing-fact behavior
- Hebrew reply structure

before paying for or trusting a model.

## Shopify-native AI

Shopify Inbox currently has an optional Inbox agent for some merchants, and Shopify also offers AI-assisted suggested replies. That can be useful as an independent storefront-chat channel if the store has access.

Do not make our architecture depend on it. Shopify Sidekick is an admin assistant and is not a customer-support message API. The internal app should keep its own orchestration layer so email, future channels, Shopify reads, approval rules, testing, and analytics behave consistently.

If a supported Shopify Inbox integration/API becomes available for our use case later, implement it as another **channel adapter**, not as the core brain.

## No-key test strategy

We can test most of the support architecture without a model API key and without the mailbox:

1. Feed synthetic customer messages into `/api/support/agent/simulate`.
2. Provide fake Shopify/order facts as fixture input.
3. Assert detected intent.
4. Assert required tools.
5. Assert risk/approval decision.
6. Assert no send/write capability exists.
7. Assert missing facts are explicit.
8. Assert the fallback draft does not invent commercial facts.

Example simulation payload:

```json
{
  "message": "איפה ההזמנה שלי? יש מעקב?",
  "locale": "he",
  "facts": {
    "order": {
      "found": true,
      "orderName": "#1234",
      "trackingAvailable": true,
      "trackingUrl": "https://example.invalid/tracking/1234"
    }
  }
}
```

Expected behavior:

- intent = `shipping_status`
- decision = `AUTO_DRAFT`
- tool plan includes order/tracking reads
- truth source includes Shopify
- sendAllowed = false
- shopifyMutationAllowed = false

## Evaluation/replay architecture

Before auto-send is ever considered, capture a test corpus of real historical support cases with private details minimized.

For each case store/evaluate:

- expected intent
- expected facts/tools
- expected escalation level
- forbidden actions
- approved final answer or resolution class

Then replay each new engine/model version against the same corpus.

Minimum release metrics should include:

- intent accuracy
- hallucinated-fact rate (target: zero)
- unsafe action proposal rate
- unnecessary escalation rate
- missing escalation rate
- draft acceptance/edit rate
- resolution rate by skill
- repeat-contact rate

## Recommended build order from here

1. Keep mailbox work paused.
2. Finish the agent kernel and simulation/replay harness.
3. Add versioned `knowledge/` packs for product, usage, shipping and returns.
4. Add read-only product/policy tools.
5. Add minimal Shopify customer-context tool if required.
6. Add a real LLM provider behind `SupportModelProvider` when credentials are available.
7. Run historical replay/evaluation.
8. Add human approval workflow for sensitive action proposals.
9. Only after measured reliability, add a separately gated send capability for low-risk skills.
10. Write actions remain separately authorized and server-controlled.
