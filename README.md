# NovaHair gallery bootstrap — isolated preview

This branch is a **sandbox-only snapshot**, not a replacement for the application branch. Do not merge it over production.

The preview has no production app configuration, deployment workflow, Shopify integration, live analytics, payment, email, or fulfillment connection. No Shopify theme or page was changed to create this preview.

## Included behavior

- Locally evaluated, deterministic 50/50 assignment using the same SHA256/first-12-hex/modulo-10,000 formula as the inspected element allocation engine.
- A QA-only visitor namespace; existing production visitor cookies are never read or written.
- Selected gallery committed once; no remote assignment request on the first-render path.
- Forced A/B inspection does not overwrite the normal sticky assignment.
- Selected-image loading/failure stays in the selected arm; no automatic switch to the opposite gallery.
- Separate assignment, rendering, image readiness, exposure, and simulated-checkout records.
- Same logical exposure deduplication within the QA tab session.
- Sandbox pause and promotion controls. These save only to this browser, not the real Funnel Control app.
- Content-Security-Policy blocks outbound fetch/XHR/beacon connections, forms, frames and workers. Public Shopify CDN images remain permitted. B assets are copied from existing repository blobs.

## What this is NOT

This is a functional gallery/buy-box fixture based on the inspected sales page, not a byte-for-byte copy of the entire store. Some styling and controls are adapted for safe testing. The previous page's secondary sections, third-party scripts, popup, mix-and-match commerce and real cart are absent. Do not use it as an images-only A/B test without checking treatment parity.

The real app's publication, assignment registration, Shopify checkout/webhook attribution, consent behavior, cache invalidation and migration of existing visitors have **not** been wired into this preview. A safe production adapter remains a separate implementation/release gate.

## Test evidence

- 14 Node logic tests passed, including 20,000 hash comparisons with Node's SHA256, deterministic replay, configuration validation and blocked-storage getters.
- 17 Chromium fixture checks passed, including mobile/desktop layouts, initial arm consistency, 3.5-second delays, failed images, duplicate initialization, sticky storage replay and a timing-only reproduction of the previous two-clock race.
- 10 local synthetic HTTP contract checks passed for registration, exposure/order deduplication, pre-registration checkout context, publication into HTML, old-phase reconciliation and process restart.

Browser test scope: this execution environment blocks browser navigation. Checks ran with `set_content`, mocked browser storage and labeled synthetic image responses. They are **not** proof of native Safari/WebView behavior, real CDN performance, actual HTTPS persistence, or production first paint. Those require additional verification. The deployed gallery assets are the existing real assets, not the synthetic test images.

A real iPhone Safari / Instagram / Facebook WebView check and Shopify development-store checkout test remain mandatory before any production release.

## Provenance

Inspected app baseline: `4129eae93c65f1893940f93c797fb34bd516c0a8` (`fix/order-webhook-reconciliation-20260908`).

Gallery image blobs: `feat/novahair-gallery-ab-production-20260907`, originally in `app/cloudflare-pilot/public/assets/novahair-gallery/`.

The hostable HTML is self-contained for the critical bootstrap code. It needs no API credentials or build step. Keep this branch separate from production and never point the live app proxy at it.
