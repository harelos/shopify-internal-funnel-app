# NovaHair gallery bootstrap — verified isolated preview

## Open the preview

- [New gallery B, clean page view](https://raw.githack.com/harelos/shopify-internal-funnel-app/5e04e3a5ad16062a757856950b77a9c7c056f544/index.html?variant=variant-b&view=page)
- [Interactive test controls](https://raw.githack.com/harelos/shopify-internal-funnel-app/5e04e3a5ad16062a757856950b77a9c7c056f544/index.html?variant=variant-b)
- [Original gallery A](https://raw.githack.com/harelos/shopify-internal-funnel-app/5e04e3a5ad16062a757856950b77a9c7c056f544/index.html?variant=control&view=page)
- [Natural sticky 50/50](https://raw.githack.com/harelos/shopify-internal-funnel-app/5e04e3a5ad16062a757856950b77a9c7c056f544/index.html)
- [Passing GitHub Actions test run](https://github.com/harelos/shopify-internal-funnel-app/actions/runs/34417030952)

The third-party raw.githack host displays an **External Content Notice** on first visit. Click its visible **Open the page** button. The host notice may contain advertising; it is not part of the NovaHair sandbox. No credentials or payment details are required. GitHub stores the source; raw.githack renders it as a website. This is not native GitHub Pages or your storefront.

## Safety and scope

This branch is a **sandbox-only root snapshot**, not an application upgrade branch. **Do not merge it over the production app.** The default application branch, production Worker and every Shopify theme/page are untouched.

The preview has no production app configuration, deployment workflow, Shopify integration, live analytics, payment, email, or fulfillment connection. Its CSP disallows outbound fetch/XHR/beacon, forms, frames and workers. Images may load from public Shopify CDN and this repository's public GitHub image paths. No production visitor cookie is read or written.

The gallery/buy-box fixture is based on the inspected sales page, but it is not a byte-for-byte copy of the full storefront. Styling and safe controls are adapted. Secondary sections, third-party scripts, popup, mix-and-match commerce and real cart are absent. Check treatment parity before calling any future test an images-only experiment.

**The actual Funnel Control app has not been connected to this prototype.** Real app publication, registration, Shopify checkout/webhook attribution, consent, identity reconciliation, cache invalidation and existing-visitor migration are separate implementation gates. The on-page publication controls save only to this browser and do not change the live experiment.

## Implemented preview behavior

- Inline configuration and deterministic local selection before gallery mounting.
- SHA256 / first 12 hex / modulo 10,000 matches the inspected backend bucketing formula.
- QA-only visitor namespace with sticky browser persistence.
- Forced A/B inspection does not overwrite natural assignment.
- One gallery controller. Selected image delay/failure never switches to the opposite arm.
- Explicit assigned, rendered, image-ready, exposure and simulated-checkout evidence.
- Logical exposure deduplication within the QA tab session.
- Local-only pause/promotion simulator with no experimental enrollment while paused/promoted.
- Thumbnails, arrows, swipes, sample shade/pack selections and simulated checkout.

## Test evidence

**Passing remote run:** 34417030952.
**Immutable tested public HTML commit:** 5e04e3a5ad16062a757856950b77a9c7c056f544.
**HTML blob:** 97e912209aac22f1a63db3d8cc446886dd5ac5e3.

- 14 Node logic tests passed, including 20,000 bucket comparisons with Node crypto: A 10,026 / B 9,974 (50.13% / 49.87%). This is a simulation, not live visitor counts.
- 17 offline Chromium fixture checks passed with explicitly mocked storage and labeled image pixels.
- 10 local synthetic HTTP contract checks passed for registration, deduplication, fast checkout, publication and restart. Not a real Shopify backend integration.
- 6 additional real-HTTP Chromium checks passed on GitHub Actions, including actual A/B assets, five reloads plus a new tab on local HTTP, delayed/failed real image requests, and the public HTTPS preview after clicking the host's content notice.
- Public HTTPS preview loaded the real B image at 1254×1254, showed no control DOM in sampled B frames, loaded A, and retained natural assignment over three reloads using real localStorage. No console errors were captured by the final public check.

Native iPhone Safari / Instagram / Facebook WebView, full-store script ordering and real Shopify checkout remain untested. No claim of 100% production readiness is made. GitHub Actions screenshots/results are retained for 7 days; the chat development ZIP includes a local copy of final evidence.

## Reproduce

```sh
node extract.cjs
node --test tests/core.test.cjs
python -m http.server 8080 --bind 127.0.0.1
```

Open `http://127.0.0.1:8080/index.html?variant=variant-b`.

The exact inline core, controller, manifest and CSS can be extracted using extract.cjs. The full local development archive supplied in chat additionally contains the local-only Node QA server and Python fixture/contract suites. No production secrets are required.

## Provenance

Inspected application baseline: 4129eae93c65f1893940f93c797fb34bd516c0a8 (fix/order-webhook-reconciliation-20260908).

B images are copied from existing repository blobs originally in app/cloudflare-pilot/public/assets/novahair-gallery/. A images are the original public Shopify CDN assets.

A one-time, narrowly checked CI edit allowed those public GitHub image redirects through the preview CSP. That helper has been removed, and the retained QA workflow is contents-read-only and performs no deployment or code writes.
