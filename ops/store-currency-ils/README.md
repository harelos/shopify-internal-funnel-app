# Shopify Store Currency Migration: USD to ILS

`currency_migration.py` audits, applies, verifies, and rolls back base variant
prices for the TigerBrandsGlobal USD-to-ILS migration. The target price for each
variant is the price already shown in the Israel market; no exchange-rate
calculation is used.

The script does not change the Shopify store currency. That owner-only action is
performed in Shopify Admin between `preflight` and `apply-prices`.

## Commands

```powershell
python currency_migration.py audit
python currency_migration.py preflight --backup <backup-json>
python currency_migration.py apply-prices --backup <backup-json>
python currency_migration.py verify --backup <backup-json>
python currency_migration.py rollback-prices --backup <backup-json>
```

Credentials are read from environment variables or the workspace `app/.env`:

- `SHOPIFY_SHOP_DOMAIN` or `SHOP_DOMAIN`
- `SHOPIFY_ACCESS_TOKEN` or `SHOPIFY_ADMIN_ACCESS_TOKEN`

Raw backups contain operational Shopify data and are intentionally excluded from
Git. Store them in an encrypted access-controlled backup location. Do not run an
apply or rollback command without the production runbook and a verified backup.
