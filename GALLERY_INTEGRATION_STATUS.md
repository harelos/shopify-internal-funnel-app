# NovaHair gallery-only integration — verified candidate, not deployed

## Preview and evidence

- **Public preview with real controls:** https://raw.githack.com/harelos/shopify-internal-funnel-app/986718fa1a06b6dcbbecccc6e5029fa7c91deb0a/integration/preview/index.html?variant=variant-b
- **Passing QA run:** https://github.com/harelos/shopify-internal-funnel-app/actions/runs/34425499666
- Implementation and full evidence: `integration/`

The preview host can display an External Content Notice. Select **Open the page**. The public-browser test follows that actual control and then checks decoded gallery images and the original page controls. Earlier public checks failed because they searched for a link while the hosting notice used another control; the image assertions were not weakened to make the test pass.

## What is preserved

The original five shade options, three package cards, displayed prices and their selection logic are preserved. The preview builder asserts unchanged `.hero-info` markup, and browser tests select a shade, select a package and exercise the original purchase-button logic through a deliberately simulated commerce adapter.

No demonstration shade/package UI is included in the real-app overlay. The public preview cannot place orders, charge customers or send production analytics. Its mocked commerce adapter and network restrictions are preview-only.

## Implemented in an isolated copy of the real app

- App-derived manifest with deterministic assignment before gallery reveal and canonical JSON hashing.
- Original visitor/experiment/allocation-version SHA256 bucketing compatibility.
- Single gallery controller; original A markup/handlers retained; B is never replaced by a late assignment response.
- Existing app start/pause/promote commands have an opt-in publishing path for one explicitly bound experiment.
- Compare-and-set publication, acknowledged failures and explicit retry.
- Immutable assignment validation; historical conflicts are rejected rather than rewritten.
- Pending context for a checkout that precedes background registration; integration with existing checkout/order attribution helpers.
- Readiness/visibility-gated exposure and retry acknowledgement with stable event IDs.

## Executed test coverage

- **19 protocol checks:** manifest construction, 20,000 original-algorithm buckets, browser/server hashing, JSON key ordering, identity conflict handling, simulated fast-checkout registration and publication conflict/failure rules.
- **7 Chromium browser scenarios:** copied real page, real shade/package controls, original A handlers, B-only mounting, duplicate initialization, same-browser persistence, failed images, unavailable storage and JavaScript-disabled fallback. Some scenarios cover multiple assertions.
- **8 actual service sequences in local Workerd/D1 with Prisma:** real database persistence/assignment reuse, pending checkout attribution, synthetic order deduplication/adjusted revenue, historical conflicts, pause, failure/retry, promotion. **Shopify publication was mocked.**
- **1 public HTTPS browser check:** real B image decoded, five original shades, three original packages, no original gallery DOM mounted in B.
- **Actual application TypeScript build passed.**

These are not 35 independent statistical experiments or a certification of every production path. Native iPhone, Shopify transport and real paid-order tests remain separate.

## Production safety

No Shopify theme or page was edited/uploaded/published. No production Worker deployment, remote database migration, analytics change, payment, email or fulfillment action was performed. Test database operations were local-only with synthetic data and blocked outbound calls. No new mode or flag was activated on the live application.

**Do not merge this entire branch into the running app.** It is deliberately an isolated sandbox, not the full application tree. Review/apply only `integration/evidence/gallery-only.patch` against pinned baseline `4129eae93c65f1893940f93c797fb34bd516c0a8`, plus separately reviewed candidate theme files. Confirm the actual deployed source before porting the patch.

## Remaining release gates

1. Verify real Shopify page-metafield permissions, exact Liquid rendering, application authentication/proxy transport and configured page binding in a separate development store or specifically approved preview resource.
2. Verify acknowledged publication against actual storefront/CDN propagation for start, pause and promotion. An API acknowledgement does not certify immediate global CDN propagation.
3. Validate first-render consent availability, returning identity, denied/late consent, storage loss and actual iPhone Safari/Meta in-app browsers. The consent-gated LIVE path is not yet certified sticky in every production browser condition.
4. Validate private cart-attribute write races, accelerated checkout, paid test orders/refunds and webhook reconciliation in a development store. Local synthetic service tests do not replace that.
5. Specify enrollment grace/expiry for historical published snapshots after pause. Retained snapshots support delayed checkout; a pure closed-enrollment unit check does not establish that all stale pages immediately stop registering.
6. Separate the clean experimental phase from prior flicker-contaminated data.

The new code stays default-disabled until explicitly configured. No production release should occur before these gates and a separate release authorization.
