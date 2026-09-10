# Gallery-only integration candidate — NOT deployed

Owner approved the new gallery rendering approach, not replacement shade/package controls. This package integrates that approach with the actual Funnel Control source while preserving the real page's shade picker, bundle cards, prices and original commerce UI.

## Safety

**This entire branch is an isolated sandbox. Do not merge it over the real application.** Its root intentionally lacks the production Worker and Shopify deployment configuration. Apply only the reviewed overlay/patch to a separate checkout of baseline `4129eae93c65f1893940f93c797fb34bd516c0a8`.

No Shopify theme uploads or publishing, page content/metafield writes, Worker deployments, remote migrations, production analytics calls, payment/fulfillment/email actions are authorized or performed here.

## Candidate implementation

- Manifest generated from the real app's published gallery variants; exact existing SHA256 visitor/experiment/version bucketing retained.
- Canonical JSON fingerprint survives key reordering in Shopify JSON/Liquid serialization.
- Existing app start/pause/promote routes opt into serialized publication only for a specifically configured experiment. Other experiments keep existing routes.
- A dedicated page metafield carries the manifest in first HTML. A candidate Liquid template replaces only the marked gallery subtree and old gallery runtime block. It does not edit the store-wide page body.
- Control preserves exact original gallery markup and existing handlers. Challenger has a single isolated controller. No demo shades or demo package design are copied to the actual integration.
- First rendering does not await remote personalized assignment. Async registration cannot change a committed gallery.
- Persistent identity blocked/consent unavailable: usable page, explicit degraded measurement, no false stable assignment guarantee.
- Server validates pending assignment against an immutable published snapshot. Same-phase existing assignment IDs are reused; historical conflicts are rejected, not overwritten.
- Pending context is present before background registration and propagated by the existing attribution companion/private cart attribute. The existing checkout ingest can resolve pending context before creating attribution snapshots.
- Exposure waits for image readiness, gallery visibility and registration. HTTP retries reuse an event ID; ack is saved only after success. Browser does not duplicate the server's canonical `experiment_exposed` event.
- Failed Shopify publication is returned as failed even when app database state already changed. CAS conflict does not trigger a blind overwrite.
- Existing cohort content/allocation/slot target are frozen. A separately approved new experiment is required for a material cohort change.

## Files

`overlay/` — additive actual app modules and migration.
`apply.py` — strict single-match patcher for a LOCAL pinned source copy. No API/deploy action.
`finalize.py` — idempotent source normalization and safeguards, run before build.
`storefront/` — maintained gallery runtime and scoped CSS.
`theme/` — candidate Liquid template and generated snippets; files only, NOT uploaded.
`build_preview.py` — real-page preview builder asserting identical shade/package DOM; original state logic retained, commerce boundary simulated.
`tests/` — tests of protocol and browser behavior. Test scope/results must be read, not inferred from file existence.
`preview/` — generated static preview after successful CI.
`evidence/` — results, screenshots and reviewed application patch after successful CI.

## Local / CI reproduction

1. Make a fresh checkout of the pinned baseline, without deploying or starting production configuration.
2. `python integration/finalize.py`
3. `python integration/apply.py /path/to/checkout`
4. Read public page HTML via a plain GET; do not execute copied production scripts.
5. `python integration/build_preview.py storefront.html /path/to/checkout integration/preview`
6. `python integration/generate_theme.py /path/to/checkout`
7. `node --experimental-strip-types --test integration/tests/protocol.test.mjs`
8. Existing app `npm run build` generates Prisma types and checks TypeScript; does not deploy.
9. Serve preview over localhost and run Playwright tests with `GALLERY_UPSTREAM=/path/to/checkout`.

## Default-disabled production boundary

No existing environment was changed. Candidate code requires `GALLERY_BOOTSTRAP_MODE`, `GALLERY_BOOTSTRAP_EXPERIMENT_ID`, `GALLERY_BOOTSTRAP_PAGE_ID`. Staging mode refuses the real sales page ID and requires a dedicated `qa-` page. A `live-approved` mode exists in code but has NOT been activated. The candidate migration must first be applied only to a separate test database.

## Outstanding release gates — do not call this production-ready yet

- Test real app HTTP, D1 and Shopify publication with a separate dev store/Worker. Pure protocol tests with injected ports do not establish that those hosted integrations work.
- Confirm actual deployed Worker source matches the pinned baseline before porting the patch.
- Verify Shopify app permission to write page metafields, exact Liquid rendering, CDN publication/pause propagation and failure recovery. A successful Admin API response is not instant global CDN confirmation.
- Test actual iPhone Safari and Meta in-app browsers; Chromium mobile viewport is not a native-device test.
- Test real Shopify customer consent states and late consent initialization without mid-page reassignment.
- Complete dev-store paid test orders/refunds and fast/accelerated checkout attribution, including cart-attribute write races, event duplication and late webhook reconciliation. Synthetic protocol coverage alone is not a financial end-to-end test.
- One measured phase must be separately identified from earlier flicker-contaminated data.

Preview can be publicly inspected with original controls but deliberately cannot place orders. Any actual production release is a separate owner decision after the above checks.
