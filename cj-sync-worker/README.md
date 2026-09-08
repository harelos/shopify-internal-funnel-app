# NovaHair Shopify to CJ worker

This folder is the production-matching source for the NovaHair fulfillment worker that runs on Railway. It creates unconfirmed CJ orders from paid Shopify NovaHair orders and later mirrors CJ status and real tracking back to Shopify.

## Production identity

- Railway project: `novahair-cj-sync`
- Railway project ID: `162f2b75-d083-4986-8f38-ac8a7f9a72b2`
- Environment: `production`
- Railway environment ID: `b492fe85-94ee-4442-9352-f869904e1edb`
- Service: `cj-sync-worker`
- Railway service ID: `228dee41-393d-4074-af97-c304e8901743`
- Start command: `python worker.py`
- Default poll interval: 900 seconds
- Default Shopify lookback: 7 days
- Current CJ order identity: `RESCUE-{Shopify order number}`

Do not infer that a Git commit is live. Compare the deployment and file hashes before production work.

## Data flow

1. `worker.py` starts a cycle.
2. `sync_novahair_orders_to_cj.py` fetches paid Shopify orders and asks `rescue_current_novahair_orders.py` to parse and create missing CJ orders.
3. CJ orders are created with `payType=3`; this worker does not pay or confirm them.
4. `monitor_cj_tracking_to_shopify.py` discovers `RESCUE-*` records, reconciles CJ status tags, and creates a Shopify fulfillment only when CJ supplies real tracking.
5. The cycle repeats after `SYNC_INTERVAL_SECONDS`.

## Files

- `worker.py`: long-running scheduler and cycle boundary.
- `sync_novahair_orders_to_cj.py`: paid-order discovery and automatic creation entry point.
- `novahair_manifest.py`: strict Shopify-line classification, exact physical mappings, fingerprints, and CJ manifest comparison.
- `rescue_current_novahair_orders.py`: Nova bundle parser, recipient validation, CJ product construction, create, and read-back verification.
- `monitor_cj_tracking_to_shopify.py`: CJ status/tracking to Shopify reconciliation.
- `cj_auth.py`: CJ token acquisition and local token cache.
- `cj_order_state.py`: normalized CJ state helpers.
- `shipment_risk.py`: pure, Israel-calendar shipment risk scoring.
- `shipment_snapshot.py`: PII-minimized Shopify + CJ reporting bridge for Commerce OS.
- `tests/test_cj_order_state.py`: current unit coverage for state normalization.
- `railway.json`, `Procfile`, `requirements.txt`: service runtime definition.

## Required environment variables

Store values only in Railway or a local untracked environment. Never commit them.

- `CJ_API_KEY`
- `SHOPIFY_SHOP_DOMAIN`
- `SHOPIFY_PII_TOKEN` or `SHOPIFY_ACCESS_TOKEN`
- `SYNC_INTERVAL_SECONDS` (optional, defaults to `900`)
- `SYNC_LOOKBACK_DAYS` (optional, defaults to `7`)
- `CJ_RECONCILE_MODE` (must be `report` until Gate B is approved)
- `ORDER_SETTLE_SECONDS` (optional, defaults to `600`)
- `SHIPMENT_BRIDGE_URL` (Commerce OS `/shipment-bridge/ingest` endpoint)
- `SHIPMENT_BRIDGE_TOKEN` (shared secret stored only in Railway and Cloudflare)

`recipient_supplement.json` may contain customer data and is ignored. Use `recipient_supplement.example.json` only as a shape reference.

## Safety invariants

- Shopify is the source of truth for order lines and recipient data.
- Never log access tokens, API keys, full addresses, phone numbers, or email addresses.
- Never pay or confirm a CJ order automatically.
- Never create a Shopify fulfillment without real CJ tracking.
- Never delete a CJ order unless its status was just re-read as `CREATED` or `IN_CART`, `paymentDate` is empty, and no tracking exists.
- Never auto-delete, replace, or split a paid, shipped, closed, or otherwise progressed CJ order.
- Unknown physical Shopify lines must block creation as `NEEDS_MAPPING`; silently omitting a physical item is not acceptable.
- Digital products and nonphysical services stay in Shopify and are not sent to CJ.
- Use one replica for any reconciliation that may replace a CJ order.
- Shipment snapshots run after the existing sync, are reporting-only, contain no
  customer name, address, phone, or email, and cannot block fulfillment.
- The shipment dashboard may suggest a customer/CJ action, but it never sends a
  message, pays CJ, cancels, refunds, or auto-rejects an order.

## Shipment risk schedule

The long-running worker still reconciles orders and tracking every 15 minutes.
The heavier shipment-risk snapshot is published at the latest due Israel-time
checkpoint (09:00, 15:00, or 21:00). A failed bridge upload is retried on the
next worker cycle. The dashboard uses Sunday–Thursday as Israeli business days;
Friday and Saturday are excluded.

## Gate A behavior

Gate A adds exact physical mappings for Hair Gloss, argan mask, keratin serum, and the live CC05 230 beauty headband. Digital guides and the VIP-priority service remain Shopify-only. Any unknown physical line blocks normal CJ creation as `NEEDS_MAPPING` instead of being silently omitted.

New CJ orders wait at least 10 minutes from Shopify `created_at`, then follow the existing unpaid `payType=3` creation path with a complete physical manifest. Existing CJ records are compared only when Shopify contains a mapped physical add-on. A mismatch is written as `CJ_MANIFEST_DRIFT_REPORT`.

The code is hard-locked to `CJ_RECONCILE_MODE=report`. It contains no deletion or replacement path. Gate B has not been approved or implemented. See [`../docs/CJ_SYNC_ADDON_RECONCILIATION_PLAN_2026-09-08.md`](../docs/CJ_SYNC_ADDON_RECONCILIATION_PLAN_2026-09-08.md).

Gate A was deployed successfully to production on 2026-09-08 as Railway deployment `a27ea4e9-46fd-4d6e-ab7c-7af5a60df348`. The first cycle reported five drifts and performed no CJ replacement. See [`../docs/CJ_SYNC_GATE_A_PRODUCTION_REPORT_2026-09-08.md`](../docs/CJ_SYNC_GATE_A_PRODUCTION_REPORT_2026-09-08.md).

## Safe local inspection

Run the existing tests:

```powershell
python -m unittest discover -s tests -v
```

The command below is a report-only sync because `--apply` is absent. It still needs production API credentials and may print operational metadata, so do not paste its output publicly.

```powershell
python sync_novahair_orders_to_cj.py --days 7
```

`worker.py` is not a dry run: it calls the sync and tracking monitor with `apply=True`. Do not run it on a workstation merely to inspect behavior.

## Production parity record

Before Gate A changes on 2026-09-08, SHA-256 comparison through Railway SSH showed the following captured baseline files were byte-for-byte identical to deployment `4443a57a-7e13-43a4-8503-c79c7fea59ac`:

| File | SHA-256 |
| --- | --- |
| `sync_novahair_orders_to_cj.py` | `1d9298e23c40879e4b4e5c2e1928910bc2b9ff70596aa7f369038edf9396a32a` |
| `rescue_current_novahair_orders.py` | `dc5aac9f95e206aed739731810433b58339a65878f5df148792b99aae46a627d` |
| `worker.py` | `94193ec56237f81165c3d5cd4a6d2789796791c114beed719270346ac036e806` |

## Operational note

Live logs showed occasional recoverable CJ `502 Bad Gateway` responses on order-list reads. Add bounded retry with jitter as a separate hardening change; it is not the cause of missing add-ons.
