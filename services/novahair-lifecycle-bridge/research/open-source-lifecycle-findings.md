# NovaHair lifecycle: open-source research and architecture decisions

Date: 2026-09-08

## Executive decision

NovaHair should not deploy a second, self-hosted marketing-automation platform beside Resend and Cloudflare for the first production release. The closest open-source Klaviyo-style product, Dittofeed, brings strong journey concepts but also Postgres, ClickHouse, Temporal and optional Kafka/Redpanda. Novu is an excellent notification-workflow reference, but its advanced repository areas include a proprietary enterprise license. Mautic, Plunk and Listmonk are useful product references but introduce GPL/AGPL obligations or a second operational stack.

The low-risk design is therefore:

- Shopify remains the source of truth for checkout, order and consent state.
- D1 owns keyed lifecycle state, eligibility, exact idempotency, scheduling and first-party attribution.
- Resend owns rendering, delivery, suppression enforcement, Events, Templates and disabled-first Automations.
- PostHog remains an analytics and experimentation layer, never the purchase source of truth.
- Every actionable send is gated against the latest purchase, checkout recovery, consent, suppression, quota and lifecycle-stage state.

This preserves the free-plan target and avoids paying the reliability tax of operating a second orchestration platform.

## Candidate assessment

| Project | What it contributes | License / operations | NovaHair decision |
|---|---|---|---|
| [Dittofeed](https://github.com/dittofeed/dittofeed) | Closest OSS Klaviyo analogue: keyed event-entry journeys, segments, subscription groups, random buckets, omnichannel providers | MIT; Postgres + ClickHouse + Temporal, optional Kafka/Redpanda | Adopt the patterns, not the stack |
| [Novu](https://github.com/novuhq/novu) | Delay, digest, throttle, conditions, topics/preferences, idempotency | MIT core; repository also contains separately licensed enterprise code | Adopt only independently implemented concepts; never copy EE code |
| [Mautic](https://github.com/mautic/mautic) | Mature campaign builder, lead scoring and segmentation | GPL-3.0 and operationally heavy | Product reference only |
| [Plunk](https://github.com/useplunk/plunk) | Workflows, segments, transactional and marketing email | AGPL-3.0; self-host stack and SES orientation | Product reference only |
| [Listmonk](https://github.com/knadh/listmonk) | Efficient lists, campaigns and subscriber management | AGPL-3.0; newsletter-centric rather than journey-centric | Product reference only |
| [Parcelvoy](https://github.com/parcelvoy/platform) | Journey/campaign concepts | MIT but archived | Reject as a production dependency |
| [Sequence](https://github.com/sequence-so/sequence) | Lightweight automation ideas | Stale maintenance history | Reject as a production dependency |
| [Svix](https://github.com/svix/svix-webhooks) | Signed webhook verification and at-least-once delivery patterns | MIT and actively maintained | Use through Resend's official webhook contract |
| [Resend webhook ingester](https://github.com/resend/resend-webhooks-ingester) | Official append-only, idempotent webhook-ingestion example | Official reference implementation | Adopt raw-body verification, unique `svix-id`, append-only receipts and retry semantics |

## Patterns adopted in the production bridge

### 1. Keyed journey instances

Dittofeed's event-entry model uses a key so one customer can have multiple independent journey instances. NovaHair applies this to abandoned checkout using Shopify checkout ID, not email. Checkout A recovering can never cancel Checkout B merely because both belong to the same address.

Reference: [Dittofeed event-entry journeys](https://github.com/dittofeed/dittofeed/blob/main/packages/docs/resources/journey-nodes/entry.mdx).

### 2. Re-evaluate eligibility before every actionable send

Klaviyo distinguishes trigger filters from profile filters and re-evaluates profile filters before actionable steps. Omnisend similarly supports continuous exit conditions and overlap prevention. NovaHair mirrors that in D1: purchase, recovery, consent, local/Resend suppression, mode, activation cutoff and quota are checked at dispatch time.

References: [Klaviyo flow filters](https://help.klaviyo.com/hc/en-us/articles/115002779051), [Omnisend workflow settings](https://support.omnisend.com/en/articles/3954813-set-up-automation-workflow-settings).

### 3. Append-only receipts plus processing state

Resend webhook deliveries are at-least-once and may arrive out of order. Each `svix-id` is stored once, with `RECEIVED`, `PROCESSING`, `PROCESSED` or `FAILED`. A failed processing attempt is eligible for a genuine webhook retry; a processed event is acknowledged as a duplicate.

References: [Resend webhooks](https://resend.com/docs/webhooks/introduction), [official Resend ingester](https://github.com/resend/resend-webhooks-ingester).

### 4. Static Resend wait filters are not exact checkout correlation

Resend documents a static event-field filter for Wait for Event, but does not document comparing an incoming recovery event dynamically with the original trigger's checkout ID. Until a live API test proves otherwise, exact checkout scheduling and cancellation stay in D1. Resend receives a checkout-specific release event only after the bridge verifies that checkout is still eligible.

Reference: [Resend Wait for Event](https://resend.com/docs/dashboard/automations/wait-for-event).

### 5. Delivery idempotency is not event idempotency

Resend documents 24-hour idempotency keys for email and batch-email APIs, not Events. The D1 outbox is therefore the authoritative event ledger. An ambiguous network failure becomes `UNCERTAIN` and is not blindly replayed, preventing duplicate Automation runs.

Reference: [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys).

### 6. Server-side purchase truth

Shopify Admin orders are the global stop signal. Storefront pixels and PostHog are useful for behavior and attribution, but a browser-side `checkout_completed` event may be absent when the completion page does not load. Signed Shopify webhooks are preferred; overlapping Admin API order polling is the fail-safe.

References: [Shopify Web Pixels](https://shopify.dev/docs/apps/build/marketing/pixels), [Shopify checkout completed event](https://shopify.dev/docs/api/web-pixels-api/standard-events/checkout_completed).

## PostHog audit

The connected PostHog project currently records useful anonymous funnel events, including `add_to_cart_succeeded`, `checkout_clicked`, `checkout_started` and `purchase_completed`, with product, bundle, UTM and order-related properties. `$identify` has not been observed recently, so Browse and Cart email triggers do not yet have reliable consented first-party identity.

Consequences:

- Browse and Cart automations remain built but `WAITING_FOR_RELIABLE_IDENTITY`.
- No email address is inferred from an anonymous visitor.
- Shopify Admin order state remains revenue truth; PostHog is supporting analytics.
- The existing `checkout_token` property should be reviewed and removed or irreversibly transformed if it is a recovery credential. No new recovery secret is sent to PostHog.

Reference: [PostHog identity resolution](https://posthog.com/docs/product-analytics/identity-resolution#choosing-your-identity-strategy).

## Revenue features worth adding

### Production gate features

- Global frequency cap similar to Klaviyo Smart Sending: suppress non-transactional collisions across all flows, with explicit exceptions for critical lifecycle messages.
- Deterministic holdout allocation stored in D1, plus an exposure ledger. Revenue lift is calculated against a control cohort; Resend-attributed revenue is never labeled incremental revenue.
- Quiet hours based on a verified customer timezone or a conservative store-time fallback.
- Rule-based bundle and quantity replenishment timing, updated later from observed repurchase intervals.
- A topic/preference model so a contact can opt out of sales content without losing necessary transactional communication.
- Dead-letter and `UNCERTAIN` queues with admin-safe observability and no secret/PII leakage.

References: [Klaviyo Smart Sending](https://help.klaviyo.com/hc/en-us/articles/115002779311), [PostHog experiment exposures](https://posthog.com/docs/experiments/exposures), [PostHog holdouts](https://posthog.com/docs/experiments/holdouts).

### Add only after enough volume

- A/B path tests that change one variable at a time and use stable assignment. Omnisend recommends at least about 100 contacts per path and materially larger samples for meaningful campaign conclusions.
- RFM segmentation built from Shopify order truth. Predictive CLV/next-order models should wait for sufficient history; Klaviyo's own guidance requires substantial purchaser and historical-order volume.
- Send-time optimization trained on delivered/clicked/purchased outcomes, not opens alone.
- Product recommendations based only on real catalog and order data.
- Digest/throttle and optional channel-provider adapters if NovaHair later adds SMS or WhatsApp with explicit cost approval.

References: [Omnisend A/B splits](https://support.omnisend.com/en/articles/4042910-set-up-a-b-test-splits-in-automations), [Klaviyo RFM](https://help.klaviyo.com/hc/en-us/articles/17797889315355), [Klaviyo predictive analytics requirements](https://help.klaviyo.com/hc/en-us/articles/360020919731).

## Explicit rejections for V1

- No second campaign engine, database cluster or paid queue.
- No anonymous Browse/Cart emailing.
- No email/name/recovery token in UTMs or public analytics payloads.
- No purchase attribution based only on opens, clicks or Resend conversion labels.
- No machine-learning replenishment or CLV claims before adequate data exists.
- No GPL/AGPL/proprietary code copied into this project.
- No production activation before the real checkout/recovery/purchase test and explicit owner `GO LIVE`.

## Implementation checklist produced by the research

1. Route abandoned-checkout events only for explicit email numbers 1–10; unmatched values end safely.
2. Fail a Shopify sync if its page cap is reached while another page exists; never advance a cursor after partial pagination.
3. Count webhook usage exactly once with an idempotent receipt and transactional D1 batch.
4. Poll paid Shopify orders with overlap before dispatch as a fail-safe global stop.
5. Keep checkout-ID-specific scheduling and cancellation in D1 until dynamic Resend correlation is proven live.
6. Keep Browse/Cart triggers disabled until a reliable consented identity link exists.
7. Test OAuth, domain, published templates, disabled Automations, signed webhooks and the two-checkout isolation case against real services before production activation.

## Live infrastructure findings

- Cloudflare OAuth is active for the owner account. The isolated `novahair-lifecycle-bridge` Worker is deployed with a ten-minute Cron and, after the real E2E gate and explicit owner approval, `LIFECYCLE_ENABLED=true` in production.
- The existing D1 database is reused. Lifecycle tables use new names and did not collide with existing application tables.
- The general Shopify token can query installation metadata but is denied on the full protected-customer-data shapes needed here.
- An existing dedicated `SHOPIFY_PII_TOKEN` was found in the merchant's established secret source. It successfully executed the full abandoned-checkout, paid-order and customer-consent GraphQL queries on API `2026-07`; it is stored directly as a Cloudflare Worker secret and is never printed or committed.
- Public DNS shows the root domain still uses Namecheap Private Email MX records. `email.tigerbrandsglobal.com` is unused, making it the preferred isolated Resend sending subdomain; no root MX record needs to change.
- PostHog has useful anonymous funnel events but no recently observed reliable `$identify` event. Browse and Cart email triggering therefore remains blocked by design until first-party consented identity is dependable.
