# NovaHair Profit & Meta Watchdog

Durable operating state for the NovaHair performance watchdog. The objective is sustainable first-order contribution profit, not Meta ROAS in isolation.

## Truth hierarchy

1. Shopify-confirmed orders, discounts, refunds, and net revenue
2. Verified CJ product and shipping costs
3. Shopify Payments fees and adjustments
4. Meta spend and attribution
5. Meta funnel metrics
6. Explicitly labelled hypotheses

Do not convert an unavailable field into an estimate. Record it as `UNKNOWN`. Do not include customer names, emails, phones, or addresses in this directory.

## Files

- `STATE.md` — current account state, economics, anomalies, and next thresholds
- `BASELINES.json` — machine-readable baseline and source-quality flags
- `EXPERIMENTS.md` — protected tests and their decision rules
- `DECISIONS.md` — chronological HOLD/ACTION/ESCALATE decisions
- `ACTIONS.jsonl` — actual verified Meta writes only; one JSON object per line

## Cycle contract

Each cycle must reread Meta, reconcile Shopify, update costs/fees where available, review material creatives, check anomalies, classify HOLD/ACTION/ESCALATE, verify any write independently, and then update these files.

Before a Meta write, reread the exact object and recent performance. After a write, reread it again and confirm the intended status or budget. Budget increases must normally be 20–30%, never stack inside four hours, and preserve interpretable tests. `ACTIONS.jsonl` stays empty when no live Meta change occurred.

## Access status at takeover

- Meta read: HYPD connector, connected to `Shopify Store 3`
- Meta write: Windsor connector verified to expose reversible ad/ad-set status and ad-set budget actions
- Shopify orders: connected and readable
- Shopify Payments fees: unavailable because the connected app lacks `read_shopify_payments` / `read_shopify_payments_accounts`
- CJ: no dedicated connected tool; verified quote matrices exist locally, but final charged fulfillment costs are not yet available

Never place connector tokens or API credentials in watchdog state.
