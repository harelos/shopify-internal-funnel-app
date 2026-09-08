# NovaHair gallery A/B release

This release is page-scoped to `/pages/novahair-sales-staging` and element-scoped to `.nova .hero-media`.

## Release order

1. Run `scripts/release-novahair-gallery.ps1` from a normal PowerShell session. It performs a dry-run build, records the previous Worker deployment, exports D1, verifies an isolated preview, applies only pending additive migrations, deploys with existing secrets preserved, and verifies production health.
2. Append `scripts/novahair-gallery-runtime-snippet.html` once to the Shopify page body, between its marker comments. Preserve a byte-for-byte page-body backup before saving.
3. Open Funnel Control → Element A/B Tests and click **Prepare approved NovaHair 50/50**.
4. Confirm the 20,000-ID allocation check and production preflight both show PASS.
5. Click **Start experiment** once.
6. Verify one control visitor and one challenger visitor on mobile and desktop. Never alter cart or popup code for this test.

## Measurement contract

- Assignment is deterministic and sticky by pseudonymous visitor ID.
- Exposure is recorded once per browser session and joined to Shopify checkout by `_funnel_context`.
- The authoritative result is paid, non-test Shopify orders and net revenue. Refunds and cancellations reduce net revenue; currencies are never silently summed.
- PostHog receives the same experiment/variant identity for exposure and verified paid-order events when server capture is configured.
- Theme Editor/internal traffic is excluded.

## Stop and rollback

- **Pause** immediately returns new requests to the untouched control gallery.
- Removing only the marked runtime snippet disables page assignment without changing the original gallery markup.
- The release script stores `deployments-before.txt` and `d1-before.sql` under `release-evidence/` before production writes.
