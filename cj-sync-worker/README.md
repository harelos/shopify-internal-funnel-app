# NovaHair CJ Sync Worker

Railway worker that creates eligible NovaHair bundle orders in CJ and copies CJ
tracking numbers back to Shopify. The worker is idempotent and does not pay CJ
orders.

## Runtime

Railway starts `python worker.py`. A cycle runs every 900 seconds by default and
uses a seven-day lookback.

Required environment variables:

- `CJ_API_KEY`
- `SHOPIFY_SHOP_DOMAIN`
- either `SHOPIFY_PII_TOKEN` or `SHOPIFY_ACCESS_TOKEN`

Optional environment variables:

- `SYNC_INTERVAL_SECONDS` (default `900`)
- `SYNC_LOOKBACK_DAYS` (default `7`)

Do not commit `.cj_token_cache.json`, `recipient_supplement.json`, operational
logs, Shopify customer data, or credentials.

## Verification

```powershell
python -m unittest discover -s tests -v
```

The lifecycle tag logic is in `cj_order_state.py`. Only one canonical status tag
and one age tag should remain after reconciliation.
