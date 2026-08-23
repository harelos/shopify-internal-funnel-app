# TIGER Bot — Implementation Status — 2026-08-23

Branch: `feat/tiger-profit-os-platform-v1`

Status: **private admin/backend implementation in progress; storefront runtime remains disabled.**

## Implemented in this slice

### 1. Persistent bot configuration
- Added Prisma models `BotConfiguration` and `BotModelVariant`.
- Configuration is keyed by shop domain.
- Model experiment allocations are stored in basis points.
- Saves are transactional: configuration + model variants are updated together.
- Stored configuration remains `DRAFT`; no customer-facing activation path exists.

### 2. Server-side validation
Added `bot-config-contract.ts` with bounded normalization and validation for:
- identity/label/welcome/placement;
- specialist routing flags;
- sales playbook text;
- discount ladder and message gates;
- contribution-margin floor;
- model allocation total = 100%;
- CRM capture settings;
- security rate/message limits.

Invalid configuration fails closed with HTTP 400.

### 3. Authenticated admin API
Added:
- `GET /api/bot/config`
- `PUT /api/bot/config`
- `POST /api/bot/decision-preview`

These routes are mounted behind the existing Shopify admin session middleware.

### 4. Deterministic orchestration layer
Added `bot-orchestrator.ts`.

Before any future LLM call it decides:
- specialist route;
- allowed server tools;
- discount authorization result;
- progressive lead-capture next field;
- sticky model experiment assignment;
- human escalation requirement.

Tool permissions are role-specific. The LLM cannot grant itself tools.

### 5. Role tool boundaries
Current policy:

**SALES**
- product.read
- policy.read
- shipping.read
- recommendation.build
- offer.request
- cart.prepare

**SUPPORT**
- policy.read
- shipping.read
- order.read_scoped
- tracking.read_scoped
- resolution.request

**RETENTION**
- product.read
- policy.read
- shipping.read
- customer.summary_scoped
- recommendation.build
- offer.request
- cart.prepare

**RISK**
- policy.read
- order.read_scoped
- tracking.read_scoped
- resolution.request
- risk.case_append
- human.escalate

**SECURITY**
- no commerce/customer tools

### 6. Admin persistence
The Bot admin screen now attempts to load/save the draft through the backend API rather than being browser-local only.

A browser-local backup is retained only as a recovery fallback if the server save is unavailable.

### 7. Tests added
- `bot-config-contract.test.ts`
- `bot-orchestrator.test.ts`

The repository test script now includes them and runs `prisma generate` first.

## QA notes

- No CI workflow is currently reporting status on the PR head, so these newly added tests must not be described as executed/passing from GitHub alone.
- The code is intentionally not merged or deployed.
- The current Git base still needs synchronization with the authoritative Cloudflare/D1 production source before this feature becomes merge-ready.
- Storefront chat injection, live model calls, coupon allocation, scoped order lookup, tracking, CRM persistence, product knowledge retrieval and analytics event ingestion are not enabled yet.

## Next engineering slices

1. Knowledge packs + product/funnel context retrieval.
2. Conversation/session persistence with pseudonymous visitor IDs.
3. Model experiment editor supporting dynamic A/B/n variants.
4. Provider adapter interface with hard cost/latency budgets.
5. Secure sales/support tool adapters.
6. Offer authorization + coupon allocation service.
7. Bot analytics event ingestion and model profitability reporting.
8. Internal simulator/E2E before any storefront deployment.
