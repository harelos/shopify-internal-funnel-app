# NovaHair CJ Gate A production report

Date: 2026-09-08

Status: **DEPLOYED AND VERIFIED - REPORT MODE ONLY**

## Release identity

- Git branch: `docs/cj-sync-handoff-20260908`
- Source commit: `4811958`
- Railway project: `novahair-cj-sync`
- Railway service: `cj-sync-worker`
- Railway deployment: `a27ea4e9-46fd-4d6e-ab7c-7af5a60df348`
- Deployment status: `SUCCESS`
- `CJ_RECONCILE_MODE`: `report`
- `ORDER_SETTLE_SECONDS`: `600`

## Verification

- 32 local unit and integration tests passed.
- A predeployment production-data dry run found exactly five manifest drifts.
- All four active physical add-on mappings resolved through CJ's exact variant endpoint with the expected exact SKU and a current price.
- The first production worker cycle completed without a sync error.
- The existing CJ-to-Shopify tracking monitor completed normally.
- The new reconciliation path performed no CJ creation, deletion, recreation, payment, confirmation, or fulfillment in its first cycle.
- The deployed source hashes match the tested local files.

## First production cycle

The sync summary was:

```text
SKIPPED: 19
ALREADY_IN_CJ: 9
CJ_MANIFEST_DRIFT_REPORT: 5
NEEDS_DATA: 1
```

The five report-only drifts remain:

| Shopify order | CJ state | Report-time replacement eligibility | Missing item |
| --- | --- | --- | --- |
| `#4406` | `CREATED` | yes | Hair Gloss |
| `#4412` | `CREATED` | yes | Hair Gloss |
| `#4413` | `CREATED` | yes | Argan hair mask |
| `#4416` | `CREATED` | yes | Keratin hair serum |
| `#4417` | `CREATED` | yes | Argan hair mask |

`#4407` remains a separate `NEEDS_DATA` exception because its available street address is only four digits. It was not created or altered.

## Deployment parity hashes

| File | SHA-256 |
| --- | --- |
| `novahair_manifest.py` | `94d84e7035b80bd7f135be8aeab503632bc45343ae9bc36a6f6d65979672e44f` |
| `sync_novahair_orders_to_cj.py` | `3f46c0b25d334a1ee0993b7d2d0ff9b81b5bc31d39b5cfb8b65d6a8bd8773036` |
| `rescue_current_novahair_orders.py` | `c06a0b5b1f02e72c788914917c038241215df440db90abd4ccd9faefc6c9f503` |
| `cj_auth.py` | `53c287c74c0d9c8f62bef92ce3b4d713df418359a2f14d2c4b482fbd6362205a` |
| `worker.py` | `94193ec56237f81165c3d5cd4a6d2789796791c114beed719270346ac036e806` |

## Gate boundary

Gate B is not implemented or enabled. The production source contains no CJ delete or replacement operation. A separate explicit approval is required before adding guarded replacement and applying it to any listed order.
