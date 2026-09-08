# Shopify order attribution runbook

## Source of truth

Shopify paid orders are the commercial source of truth. Browser events may
describe checkout behavior, but they never create purchase or revenue records.

The production app subscribes to:

- `orders/paid` for the first authoritative paid-order record.
- `orders/updated` for refunds, cancellations and post-purchase total changes.

Both topics deliver to:

`https://shopify-funnel-control.tigerbrands-funnel.workers.dev/webhooks/shopify`

The handler verifies the Shopify HMAC, topic, webhook ID and shop domain before
writing. `shopifyOrderGid` and `webhookId` are unique, so replayed deliveries do
not duplicate orders or revenue.

## Release procedure

1. Work from an isolated clean branch.
2. Validate the named production configuration:
   `shopify app config validate --config funnel-control --json`
3. Run the Worker test suite.
4. Commit and push the checkpoint before release.
5. Deploy the Shopify app configuration with `--config funnel-control`.
6. Confirm the new app version is active.
7. Query Shopify webhook subscriptions and confirm `ORDERS_PAID` and
   `ORDERS_UPDATED` point to the production handler.
8. Confirm the next real paid order creates one `ShopifyWebhookDelivery`, one
   `OrderAttribution` and one server-owned purchase event.

## Reconciliation rule

The database order count must be compared with Shopify for the same
`Asia/Jerusalem` reporting window. Missing Shopify orders are imported as
unattributed rather than silently assigned to a popup, campaign or experiment.
Experiment attribution is added only when a verified cart/checkout identity
chain exists.

## Failure response

If Shopify has more paid orders than D1:

1. Mark revenue and experiment reports as incomplete.
2. Check the active app version and webhook subscriptions.
3. Check recent `ShopifyWebhookDelivery` rows and Worker errors.
4. Restore subscriptions or roll back to the last known-good app version.
5. Run idempotent order reconciliation for the missing window.
6. Do not select an experiment winner until the data-quality gate passes.

No secret value, customer email, phone number or message content belongs in
this runbook or in Git history.
