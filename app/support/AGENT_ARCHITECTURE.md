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

The system must never invent prices, shipping terms, delivery promises, discounts/coupon codes, guarantees, inventory, refund/return/exchange rules, refund amounts, order/tracking state, customer private information, internal margin, COGS or supplier costs.

If a required fact is missing, the engine must call an approved read tool, ask for missing information, or escalate.

## Common skill catalog

The staging catalog covers:

- Shipping / tracking (WISMO)
- Shipping policy
- Delivery issue / delivered-not-received / stalled tracking
- Cancel order
- Change order
- Change shipping address
- Return request / status
- Exchange request / status
- Refund request / status
- Damaged item
- Wrong or missing item
- Product usage / question / recommendation
- Shade/color recommendation
- Stock request
- Discount request
- Feedback
- Thank-you / no reply required
- Legal / chargeback escalation
- Unknown / other

Every skill owns intent triggers, required facts, allowed tools, risk level, default decision, escalation conditions and draft strategy.

A lightweight deterministic sentiment signal is recorded for routing/analytics. Sentiment never authorizes a business action.

## Customer and Shopify context

The support agent must not load a broad copy of the Shopify customer database into model context.

Use progressive retrieval:

1. Resolve customer identity from support-thread email and/or order number.
2. Read a reduced order view.
3. Read fulfillment/tracking only if needed.
4. Read product facts only for product-related questions.
5. Read minimal customer identity context only when it materially changes the resolution.
6. Do not persist broad Shopify customer profiles.

Implemented Shopify reads:

### Reduced order context

Behind `SUPPORT_SHOPIFY_LOOKUP_ENABLED=true`, the app can retrieve reduced order/payment/fulfillment/line-item/tracking context by an email derived from the support thread. The returned Shopify payload is not persisted by the support module.

### Minimal customer identity context

A separate adapter now exists behind **both** the general Shopify support-read gate and `SUPPORT_SHOPIFY_CUSTOMER_LOOKUP_ENABLED=true`.

It requests only:

- customer id
- first name
- last name
- default email address

It requires an exact normalized email match and deliberately does not request phone, address, tags, spend, marketing data, tax data or other broad profile fields. The result is not persisted.

This adapter additionally requires intentional Shopify `read_customers` authorization/protected-customer-data approval. The branch does **not** automatically add `read_customers` to the default app scopes. The code can therefore exist safely while the capability remains disabled until explicitly approved.

## Versioned knowledge packs

Product instructions and store policies cannot live as unversioned prompt text.

A pack has `DRAFT`, `APPROVED`, or `RETIRED` status, an explicit version/effective date, and source metadata. Every fact is `KNOWN` or `UNKNOWN`.

Rules:

1. A `DRAFT` or `RETIRED` pack cannot answer customer facts.
2. `KNOWN` must contain an explicit value and source.
3. `UNKNOWN` stays unknown; neither rules nor a model may fill it from memory.
4. Product lookup uses approved exact keys/titles/aliases rather than fuzzy guessing.
5. The server chooses the pack path; the client/model cannot choose or self-approve a pack.
6. The repository template intentionally contains no real commercial claims.

Implemented knowledge reads:

- approved shipping/returns policy facts
- approved product facts
- approved usage instructions
- approved shade guidance

The context broker returns an evidence trail with pack id, version and source, or an explicit reason a fact was unavailable.

## Tool authorization classes

### Automatically callable read/internal tools

- `READ_SHOPIFY_ORDER`
- `READ_TRACKING`
- `READ_PRODUCT_FACTS`
- `READ_STORE_POLICY`
- `REQUEST_CUSTOMER_INFO`
- `ESCALATE_HUMAN`

`READ_RETURN_STATUS` is defined but remains planned until an authoritative returns/exchange status source is connected.

### Sensitive read

- `READ_SHOPIFY_CUSTOMER`

The adapter is implemented, but the capability remains disabled by default and requires a separate gate plus intentional Shopify customer-data authorization. Retrieve minimum fields only.

### Proposal-only write tools

- `PROPOSE_CANCEL_ORDER`
- `PROPOSE_ADDRESS_CHANGE`
- `PROPOSE_ORDER_EDIT`
- `PROPOSE_RETURN`
- `PROPOSE_EXCHANGE`
- `PROPOSE_REFUND`
- `PROPOSE_RESHIP`

The agent may plan these actions, but the current system cannot execute them.

### Discounts

The model never creates an offer. It may request `REQUEST_SERVER_OFFER`. A later server-side offer engine owns customer eligibility, margin/authorization guards, exact discount value, previous-offer history, frequency limits, product restrictions, campaign/experiment attribution, expiration and coupon issuance. The agent never receives COGS or contribution margin.

## Decision matrix

### AUTO_DRAFT

Safe informational cases when facts are available: order/tracking status, shipping policy, product-use instructions, product questions, stock, shade/product guidance, refund status, return/exchange status when an authoritative status source exists, and ordinary feedback acknowledgement.

`AUTO_DRAFT` does **not** mean auto-send.

### HUMAN_APPROVAL

Cancellation, address/order edits, return/exchange/refund requests, damaged/wrong item resolution, reship/replacement, delivery exceptions and discount requests.

### HUMAN_ONLY

Legal threats, chargebacks, unknown intents, low-confidence/high-risk combinations, policy conflicts, or ambiguous customer identity for a sensitive action.

### NO_REPLY

Clear thank-you/acknowledgement where no response is needed.

## Model/provider layer

`SupportModelProvider` is the model boundary. Orchestration, facts, authorization and tools stay server-side.

The current deterministic provider needs no API key and lets us test routing, fact requirements, Shopify lookup planning, escalation, authorization, missing-fact behavior and Hebrew reply structure before introducing a model.

## No-key simulation

`POST /api/support/agent/simulate` is staging-only and can test the decision pipeline without a mailbox or model key.

Any `facts` submitted directly to this endpoint are **synthetic staging test input only**. Production truth must come from server-side approved tools/knowledge, never client-submitted facts.

With knowledge enabled, the simulator loads the server-selected pack, resolves only facts required by the detected skill and returns the knowledge evidence trail.

Expected hard invariants:

```text
sendAllowed = false
shopifyMutationAllowed = false
```

## Replay/evaluation architecture

`GET /api/support/agent/replay` runs a synthetic regression corpus without a mailbox or LLM key.

The suite contains more than 20 common ecommerce/beauty cases and asserts expected intent, decision, required tools, forbidden draft patterns, no-send and no-Shopify-mutation behavior. It already caught and prevented a real classification miss for delivered-but-not-received wording.

Historical support cases can later be anonymized/minimized and added to the same replay system.

Future release metrics should include intent accuracy, hallucinated-fact rate (target zero), unsafe action proposal rate, unnecessary/missing escalation, draft acceptance/edit rate, resolution rate by skill and repeat-contact rate.

## Shopify-native AI

Shopify-native support/AI features can be treated as independent channels where useful, but the internal architecture must not depend on them. Any future Shopify Inbox integration should be another channel adapter rather than the core brain.

## Current build order

Completed in this staging branch:

1. Agent kernel and deterministic provider.
2. Intent/skill catalog and policy engine.
3. Read/proposal tool registry.
4. Read-only Shopify order context.
5. Versioned knowledge-pack contracts and fail-closed loader.
6. Product/policy knowledge reads and context broker.
7. Synthetic no-key replay/evaluation harness.
8. Separately gated minimal Shopify customer identity adapter.

Next:

1. Populate the first real store knowledge pack from authoritative store/Shopify sources, leaving uncertain facts `UNKNOWN`.
2. Add anonymized historical replay cases when available.
3. Add a real model behind `SupportModelProvider`, still draft-only.
4. Build human approval UI/workflow for sensitive proposals.
5. Audit dependency advisories before production.
6. Only after measured reliability, add a separately gated send capability for an explicit allowlist of low-risk informational skills.
7. Keep write actions separately authorized and server-controlled.

## Hard release invariant

No model, prompt, channel or customer input can override:

```text
sendAllowed = false
shopifyMutationAllowed = false
```
