# NovaHair CJ add-on reconciliation plan

Status: **Gate A deployed and verified in report-only mode; Gate B not approved**

Audit date: 2026-09-08

Scope: paid Shopify orders originating from the live NovaHair flow at `https://tigerbrandsglobal.com/pages/novahair-sales-staging` and represented in CJ as `RESCUE-{Shopify order number}`.

No Shopify order, CJ order, Railway deployment, storefront code, or production variable was changed during this audit.

## Executive finding

The worker correctly expands the primary `NOVASALE-*` line into individual NovaHair bottles and one free kit. It does not project any other Shopify line into CJ. It also considers the presence of any `RESCUE-*` order sufficient for idempotency and never compares that CJ order with the latest Shopify order lines.

This creates two defects:

1. **Projection defect:** physical cart cross-sells and physical AfterSell items are ignored.
2. **First-write-wins defect:** a CJ order created before an AfterSell update is never reconciled afterward.

A real timing trace confirmed the race: Shopify order `#4417` was created at 06:00:07 +03, the current worker created its CJ record at approximately 06:00:47 +03, and AfterSell updated the Shopify order at 06:02:45 +03. CJ consequently contains only the original bottles and gift.

## Production evidence

The read-only audit found these current unpaid CJ records with missing physical items:

| Shopify order | Shopify physical contents | Missing from current CJ record | CJ state at audit |
| --- | --- | --- | --- |
| `#4417` | 4 black NovaHair bottles + free kit + argan hair mask | Argan hair mask | `CREATED`, unpaid |
| `#4416` | 4 dark-brown NovaHair bottles + free kit + keratin hair serum | Keratin hair serum | `CREATED`, unpaid |
| `#4413` | 2 light-brown NovaHair bottles + free kit + argan hair mask | Argan hair mask | `CREATED`, unpaid |
| `#4412` | 4 black NovaHair bottles + free kit + Hair Gloss | Hair Gloss | `CREATED`, unpaid |
| `#4406` | 4 dark-brown NovaHair bottles + free kit + Hair Gloss | Hair Gloss | `CREATED`, unpaid |

These are repair candidates, not an authorization to mutate them. Re-read state immediately before any future replacement.

The Gate A production-data dry run returned exactly these five manifest drifts, all then reported as `CREATED`, unpaid, untracked, and replaceable candidates. It performed no writes.

Deferred cases:

- `#4391` contains a physical scalp-brush cross-sell, but its CJ record is already paid and `UNSHIPPED`. Never auto-delete it; handle it separately later as requested.
- `#4365` has multiple historical CJ rescue records, including split shipped add-ons. It is already excluded from automatic tracking logic and must remain untouched.
- `#4407` has no CJ rescue record because the available street address is only four digits. It remains a separate `NEEDS_DATA` exception and is not part of add-on reconciliation.

## Product classification and mappings

### Verified physical mappings

Every mapping must match both the Shopify variant ID and expected Shopify SKU. CJ identity is the exact variant ID and exact CJ variant SKU.

| Shopify variant | Shopify SKU | Item | CJ variant ID | Exact CJ variant SKU |
| --- | --- | --- | --- | --- |
| `50459892580647` | `CJJT228873001AZ` | Hair Gloss 100 ml | `2502110727121606600` | `CJJT228873001AZ` |
| `52010595320103` | `CJYD231269201AZ` | Argan hair mask 500 g | `2503011116441608900` | `CJYD231269201AZ` |
| `52010652401959` | `CJYD268780701AZ` | Keratin hair oil/serum 50 ml | `2512250315511638400` | `CJYD268780701AZ` |
| `51885840400679` | `CJYD3055354` | Beauty headband, CC05 230 | `2608130207121632101` | `CJYD305535402BY` |

The headband mapping was resolved on 2026-09-08 by matching the exact live Shopify cross-sell image filename (`d0e60057-38b4-4066-a555-8a5f6b4c6609.jpg`) to CJ's exact variant image filename. The other two CJ variants use different images.

### Physical mappings that require a deliberate variant choice

- Shopify variant `51885840072999`, generic SKU `CJYD1973934`, scalp brush. Historical order `#4365` used purple CJ variant `1760593893348872192` / `CJYD197393402BY`, but this must be recorded explicitly before new automatic fulfillment.
- Shopify variant `51885840138535`, generic SKU `CJYD3068279`, steam cap. CJ exposes 19 variants; no canonical choice is established.

### Shopify-only lines

These lines are intentional nonphysical purchases and must not be included in CJ or counted as manifest drift:

| Shopify variant | SKU | Classification |
| --- | --- | --- |
| `51878069535015` | none | VIP priority service bump |
| `51880636875047` | `ELASTIC-DIGITAL-GUIDE` | Digital hair-recovery guide |
| `51880681472295` | `MASK-DIGITAL-GUIDE` | Digital Glass Skin guide |

## Gate A implementation

### 1. Build a canonical expected physical manifest

For every eligible Shopify order:

1. Require exactly one supported `NOVASALE-*` parent line.
2. Expand that parent into the existing bottle variants plus one free kit.
3. Examine every remaining Shopify line.
4. Add an allowlisted physical item only when Shopify variant ID and expected SKU both match.
5. Explicitly classify known digital/service lines as `SHOPIFY_ONLY` and log only their non-sensitive identifiers.
6. Fail closed as `NEEDS_MAPPING` when an unknown physical line is present. Do not create an incomplete CJ order.
7. Include Shopify's line-item ID as CJ `storeLineItemId` on each directly mapped add-on. For decomposed bundle components, use a deterministic derived trace key if CJ accepts it; otherwise persist the Shopify parent line ID in the audit manifest.
8. Calculate a stable fingerprint over sorted `{source_line, cj_vid, cj_sku, quantity}` entries.

### 2. Allow the order to settle

Do not create the first CJ order until the Shopify order is at least 10 minutes old. Use `created_at`, not `updated_at`, because this worker's own Shopify tag updates can change `updated_at`.

Ten minutes prevents the observed 2 minute 38 second AfterSell race. Ongoing manifest reconciliation remains necessary because a later update may still arrive outside that window.

Proposed variable:

```text
ORDER_SETTLE_SECONDS=600
```

### 3. Reconcile instead of merely checking existence

On every cycle while a CJ order is replaceable:

1. Build the latest expected Shopify physical manifest.
2. Fetch the complete actual CJ product manifest.
3. If manifests match, record the fingerprint and skip.
4. If they differ and CJ is currently `CREATED` or `IN_CART`, has no payment date, and has no tracking, mark it replaceable.
5. If they differ and CJ has progressed beyond that state, create a manual exception. Never auto-delete it.

The CJ API does not document a normal-order endpoint for editing product lines. Its delete endpoint is limited to `CREATED` or `IN_CART`, so controlled delete-and-recreate is the proposed reconciliation method for replaceable orders.

### 4. Gate B replacement design, not implemented

Replacement must run in the single worker replica and follow this sequence:

1. Re-fetch Shopify and CJ immediately before mutation.
2. Verify expected manifest and re-check CJ status, empty payment date, and absent tracking.
3. Write a redacted replacement-intent audit entry with old manifest, expected fingerprint, and order number.
4. Delete the existing CJ record.
5. Recreate the same `RESCUE-{number}` with the complete manifest and `payType=3`.
6. Fetch the new CJ record and require exact product/quantity equality.
7. Record the new CJ ID and verified fingerprint without customer PII.
8. If creation fails after deletion, stop that cycle. Shopify remains the source of truth and the next cycle may retry creation.

Do not create a second add-on-only CJ order by default. Historical order `#4365` demonstrates that split records create duplicate-order and tracking complexity and may add avoidable shipping cost.

### 5. Use two approval gates

Proposed modes:

```text
CJ_RECONCILE_MODE=report
CJ_RECONCILE_MODE=replace_created
```

- `report`: compute and log redacted drift; zero CJ deletion or creation caused by reconciliation.
- `replace_created`: permit guarded replacement only for records that pass all state checks.

The first deployment must stay in `report`. Enabling `replace_created` requires a second explicit merchant approval after reviewing live report output.

## Required tests

Add tests before deployment for:

- Bundle-only order produces the unchanged bottle-plus-gift manifest.
- Supported physical cart cross-sell is included.
- Supported physical AfterSell line is included.
- Known digital guide is excluded without causing drift.
- VIP priority service is excluded without causing drift.
- Unknown physical line returns `NEEDS_MAPPING` and creates nothing.
- Matching CJ manifest is idempotent.
- Drift on `CREATED`, unpaid, untracked CJ record is reportable/replaceable.
- Drift on `IN_CART`, unpaid, untracked CJ record is reportable/replaceable.
- Drift on paid, `UNPAID`, `UNSHIPPED`, shipped, or tracked CJ records never deletes.
- A second run after successful replacement is a no-op.
- Failure between delete and recreate is recoverable from Shopify on the next cycle.
- CJ read failures receive bounded exponential retry with jitter and do not mutate state on uncertainty.

## Proposed rollout after approval

1. Implement manifest building, strict classification, fingerprinting, state guards, and tests locally.
2. Run unit tests and a production-data dry report.
3. Deploy with `CJ_RECONCILE_MODE=report` only.
4. Observe at least one full worker cycle and compare the expected mismatch set with the five candidates above.
5. Return the redacted report to the merchant. Make no replacements yet.
6. After a second explicit approval, enable guarded replacement for the frozen candidate set.
7. Read back all five CJ orders and prove exact quantities.
8. Leave continuous reconciliation enabled for future physical cart and AfterSell lines while CJ remains replaceable.
9. Address paid order `#4391` in a separate manual plan.

## Acceptance criteria

- Every supported physical Shopify item appears in CJ with exact CJ variant and quantity.
- Digital/service bumps never appear in CJ.
- No unknown physical item is silently omitted.
- Late AfterSell lines are discovered before CJ progression or surfaced as manual exceptions.
- No paid, tracked, shipped, closed, or uncertain CJ record is automatically deleted.
- No duplicate add-on-only order is created.
- Every replacement has a redacted, reproducible audit trail.
- Existing tracking-to-Shopify behavior remains unchanged.
- The current Meta comment-monitoring automation remains untouched.

## Approval gates

Gate A was approved and completed in Railway deployment `a27ea4e9-46fd-4d6e-ab7c-7af5a60df348`. It authorized implementation, unit tests, and a Railway deployment in `report` mode only. Gate A did **not** authorize deleting or recreating any CJ order, and none was deleted or recreated.

Gate B will be requested separately after the report-mode output is reviewed.
