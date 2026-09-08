# NovaHair Lifecycle — Production Readiness Report

Generated: 2026-09-08

## Production status

`GO LIVE` was explicitly approved by the owner on 2026-09-08. The real abandoned-checkout end-to-end gate and the isolated verified-sender smoke test both passed before activation. Production is now enabled for the four identity-safe flows: Abandoned Checkout, Welcome, Post-Purchase, and Replenishment / Winback. Browse Abandonment and Abandoned Cart remain intentionally disabled until a consented storefront identity link is reliable.

- Cloudflare Worker: `https://novahair-lifecycle-bridge.tigerbrands-funnel.workers.dev`
- Active Worker deployment: `d452dbfd-2e13-4c8e-95ae-cce90dda34a9`
- Analytics code deployment: `50603e7e-6fc0-48aa-a464-03fa15e6354c`
- Mode: `production`
- Dispatch: `LIFECYCLE_ENABLED=true`
- Production activation cutoff: `2026-09-08T19:01:36.122Z`
- Cron: `*/10 * * * *`
- D1: `shopify-funnel-control-db` (`3b3d2e40-28b3-456f-9109-2607fbc51b17`)
- Private health status: `healthy`
- Open errors / dead schedules / uncertain events / pending contact updates: `0 / 0 / 0 / 0`
- Resend plan: Free; no card, upgrade, pay-as-you-go, or paid service was enabled.

## Real E2E proof

A real Shopify NovaHair checkout was created with marketing consent, detected through `abandonedCheckouts`, persisted once in D1, and emitted once to Resend. Resend started one checkout automation run and delivered one RTL email. Its CTA restored the exact Shopify checkout and preserved the standard UTM values. The checkout was then completed as a no-charge test order, and the bridge emitted recovery, purchase, and post-purchase events. All nine remaining checkout-email schedules were cancelled. No second checkout email or automation run was created.

The zero-value test order was cancelled, archived, and restocked in Shopify. Its future replenishment schedule was also cancelled. The temporary test discount and its temporary Worker endpoint were deleted.

Observed delivery events for the real email: sent, delivered, opened, and clicked. Multiple legitimate click events can exist for one message; webhook event IDs remain idempotent.

## Required test matrix

| # | Test | Result |
|---:|---|---|
| 1 | Resend OAuth | PASS — official integration connected |
| 2 | Dedicated Worker credential | PASS — stored only as a Cloudflare secret |
| 3 | Shopify `abandonedCheckouts` query | PASS — current credentials and API `2026-07` |
| 4 | Real abandoned checkout detected | PASS |
| 5 | Duplicate poll creates no duplicate run | PASS |
| 6 | Email 1 RTL rendering | PASS — visually verified in Gmail |
| 7 | Recovery URL restores checkout | PASS |
| 8 | Recovery before Email 1 prevents send | PASS — automated integration test |
| 9 | Recovery after Email 1 prevents Email 2 | PASS — real E2E and integration test |
| 10 | Purchase stops first-purchase recovery | PASS |
| 11 | UTM survives recovery link | PASS — real click and automated parser test |
| 12 | Same email, two checkout IDs | PASS — checkout-specific correlation test |
| 13 | Unsubscribed user receives no marketing send | PASS |
| 14 | Hard bounce suppresses further marketing | PASS |
| 15 | Temporary Resend failure retries safely | PASS |
| 16 | Temporary Shopify failure loses no state | PASS |
| 17 | Duplicate webhook is ignored | PASS |
| 18 | Post-purchase begins only after verified Shopify purchase | PASS |
| 19 | Replenishment uses bundle/quantity timing | PASS |

Local verification: 37 tests passed, 0 failed; TypeScript build, Worker bundle, and Wrangler dry-run all passed.

## Private analytics and application handoff

The production Worker now exposes a PII-free, server-only analytics contract for the internal application:

- `GET /api/lifecycle/health`
- `GET /api/lifecycle/admin/flows`
- `GET /api/lifecycle/admin/analytics?from=<ISO>&to=<ISO>`

All three require the `LIFECYCLE_ADMIN_TOKEN` bearer credential. Unauthorized requests intentionally return `404`. The live catalog and analytics endpoints both returned `200` during production verification; the catalog returned all 6 flows and 39 emails with full approved copy, timing, template links and automation links. The analytics endpoint returns flow/email delivery, open, click, failure, suppression, order and revenue metrics while explicitly excluding customer email, name, recovery URL and customer entity IDs.

Shopify remains final revenue truth. First-party attributed revenue uses a 30-day last-click model with exact checkout correlation preferred, and is never described as incremental revenue. Resend's provider dashboard remains useful for delivery diagnostics, but no unsupported Resend revenue value is invented. See `ANALYTICS-INTEGRATION.md` and `HANDOFF.md`.

## Shopify

- Store: `jacobfelipe.myshopify.com`
- Storefront: `tigerbrandsglobal.com`
- Admin GraphQL API: `2026-07`
- Shopify webhook endpoint: `https://novahair-lifecycle-bridge.tigerbrands-funnel.workers.dev/api/lifecycle/webhooks/shopify`
- `ORDERS_CREATE`: `gid://shopify/WebhookSubscription/2068250394919`
- `ORDERS_PAID`: `gid://shopify/WebhookSubscription/2068250460455`
- Provisioning was called twice after creation and created zero duplicates.
- The ten-minute overlap poll remains a loss-prevention fallback.

## Resend resources

### Domain and webhook

- Sending domain: `email.tigerbrandsglobal.com`
- Domain ID: `e1401d48-e7b5-484c-ad0f-a847ed967241`
- Status: `verified`
- Region: `eu-west-1`
- Open tracking: enabled and DNS-verified
- Click tracking: enabled and DNS-verified
- Tracking subdomain: `links.email.tigerbrandsglobal.com`
- Active webhook ID: `4514eb9f-cff3-4fe9-9255-b40827c0b6f8`
- Webhook signature verification: enabled

The isolated verified-sender smoke email (`e105f03f-9f17-433f-a829-2321d83bdf97`) was sent from `hello@email.tigerbrandsglobal.com` to the merchant-controlled test address with `support@tigerbrandsglobal.com` as Reply-To. Resend reports `clicked`. D1 independently received and processed exactly one signed webhook for each of `email.sent`, `email.delivered`, `email.opened`, and `email.clicked`. The final click arrived through the branded tracking domain and the smoke gate is recorded as `completed` / `OK` at `2026-09-08T18:55:32.096Z`.

### Automations

All 39 send steps now use `NovaHair <hello@email.tigerbrandsglobal.com>` with `support@tigerbrandsglobal.com` as Reply-To. Four automations are enabled; the two identity-gated storefront flows remain disabled.

| Flow | Automation ID | Status |
|---|---|---|
| Abandoned Checkout — D1 Correlated | `01a0811e-4e70-77a5-ac70-4f4f712e3de6` | `enabled` |
| Welcome | `01a0811e-62d3-7129-b4e0-a7c650cff04e` | `enabled` |
| Abandoned Cart | `01a0811e-6ee5-733f-8a22-6a30f89b22fa` | `disabled` — identity gate |
| Browse Abandonment | `01a0811e-79eb-728e-a789-28ff6180a6e7` | `disabled` — identity gate |
| Replenishment / Winback | `01a0811e-868c-765e-aa6f-27f727a436ca` | `enabled` |
| Post-Purchase | `01a0811e-9e6d-77dd-94d1-1de86fbb4a2d` | `enabled` |

### Event definitions

| Event | Event ID |
|---|---|
| `shopify.checkout_abandoned` | `01a080fc-2184-774d-a129-fe1031bb7e95` |
| `shopify.checkout_recovered` | `01a080fc-2473-76ce-bd45-293ac6da89a0` |
| `shopify.purchase_completed` | `01a080fc-269d-7478-a332-c6eeec365e28` |
| `shopify.marketing_subscribed` | `01a080fc-28fe-7119-aa61-660dce9e2873` |
| `shopify.post_purchase_started` | `01a080fc-2c16-76ce-bac7-12ff37d8c04f` |
| `shopify.replenishment_due` | `01a080fc-2ee6-72ae-9e4d-488307d054b3` |
| `storefront.cart_abandoned` | `01a080fc-3128-7520-a284-5eb090cc4390` |
| `storefront.product_browsed` | `01a080fc-33d5-711e-bab8-ea2d5a5692b2` |
| `lifecycle.browse_stop` | `01a080fc-376f-71be-b553-eb4d2dbd475a` |
| `lifecycle.cart_stop` | `01a080fc-3a16-7639-abfd-717c6f2bc3a1` |
| `lifecycle.replenishment_stop` | `01a080fc-3e01-727f-b550-5b68cebc20b1` |

### Published templates

| Alias | Template ID |
|---|---|
| `novahair_abandoned_checkout_e01` | `240bceec-535f-4ac7-9f1a-e2b87c6b3707` |
| `novahair_abandoned_checkout_e02` | `70c4abf4-27f2-433b-92ac-8533aa837b34` |
| `novahair_abandoned_checkout_e03` | `9abdba5d-5a53-42af-9ab0-b259589e89d0` |
| `novahair_abandoned_checkout_e04` | `1e636b2a-9d72-482c-a588-f606ca7445d9` |
| `novahair_abandoned_checkout_e05` | `788f945b-5ca1-4630-8755-78ebcbc13f03` |
| `novahair_abandoned_checkout_e06` | `87e5b9a9-1fb1-41cd-8190-2dfe815a6542` |
| `novahair_abandoned_checkout_e07` | `b24a61bb-00b9-49f4-9bb0-9f2b6f5afa9a` |
| `novahair_abandoned_checkout_e08` | `e76a50d2-6336-47fe-8026-53f3b4f2cbfa` |
| `novahair_abandoned_checkout_e09` | `eb7eb77e-ce07-4967-ba8b-3673439a8160` |
| `novahair_abandoned_checkout_e10` | `5ca05b8a-f317-4529-93ac-b74cd0a80193` |
| `novahair_welcome_e01` | `becadcf7-1c8f-493e-9af5-1910bafd47f8` |
| `novahair_welcome_e02` | `2451ab69-6074-4dad-8ce1-82ffa8ea5b73` |
| `novahair_welcome_e03` | `e82483ef-815e-48ca-af73-70c9ca2d16e5` |
| `novahair_welcome_e04` | `7db53e12-60aa-42b0-bae4-bbfbeae196e1` |
| `novahair_welcome_e05` | `deeac16b-fdd6-46c1-8a89-b5abd3b9bf37` |
| `novahair_welcome_e06` | `16294b89-1405-4b88-bc4a-54fbc3f4b056` |
| `novahair_welcome_e07` | `4f6f6fb5-87c3-48b8-982a-19d61b6e75ad` |
| `novahair_welcome_e08` | `2633b226-08b3-4e42-ba69-dc6fb96911b1` |
| `novahair_welcome_e09` | `bce20069-4a33-4545-a781-5d11d22ef001` |
| `novahair_welcome_e10` | `6308b163-9cf8-4bc1-98b2-3bc9727a87ff` |
| `novahair_abandoned_cart_e01` | `88e737c5-26e0-4e4a-8b5c-9351821da4a0` |
| `novahair_abandoned_cart_e02` | `a3324c44-3092-4e08-b362-036e82c62562` |
| `novahair_abandoned_cart_e03` | `93232f4a-0f33-4b6b-b2de-9b4bda9702c0` |
| `novahair_abandoned_cart_e04` | `4ce0b1d9-915f-43fa-9496-974c113a292c` |
| `novahair_abandoned_cart_e05` | `d86ef227-9d41-4c93-86f6-ded9f755c557` |
| `novahair_browse_abandonment_e01` | `7ad55315-8974-485e-9c35-274ac08fc201` |
| `novahair_browse_abandonment_e02` | `67d70172-2494-4645-b0b5-1a3258c437c9` |
| `novahair_browse_abandonment_e03` | `ef3eab34-36d6-4172-93f1-e66d67ff312c` |
| `novahair_post_purchase_e01` | `fb91c206-7f84-4250-bcd5-d7be2c1e2a65` |
| `novahair_post_purchase_e02` | `d5aea6b5-d887-4e2f-9216-bba2a014a235` |
| `novahair_post_purchase_e03` | `5f7dcce3-c505-43d4-a157-ae051511a529` |
| `novahair_post_purchase_e04` | `72b71117-0c25-4214-ae2c-b128d62108d1` |
| `novahair_post_purchase_e05` | `8058a600-1598-4d84-9f77-b8006583e28b` |
| `novahair_post_purchase_e06` | `66372518-e9ef-41d4-aaa9-727e4bf8409f` |
| `novahair_post_purchase_e07` | `e5f23935-0466-4506-94cf-4a2e7fcd8f55` |
| `novahair_replenishment_e01` | `f177a45e-36f1-4289-9010-7efd95a441d4` |
| `novahair_replenishment_e02` | `239cf3b9-8a1b-45a5-865d-94bbb0b380d2` |
| `novahair_replenishment_e03` | `2feccb2f-4e48-4804-b31b-61bc45011a65` |
| `novahair_replenishment_e04` | `120dd83d-0250-46a6-8c17-a58a8a6ddfc0` |

## DNS configuration

The authoritative nameservers are Namecheap (`dns1.registrar-servers.com` and `dns2.registrar-servers.com`). On 2026-09-08 the zone was read through the Namecheap API, all 13 pre-existing host records were preserved, and the following Resend records were added:

| Purpose | Type | Host | Value | Priority |
|---|---|---|---|---:|
| DKIM | TXT | `resend._domainkey.email` | Exact public key issued by Resend | — |
| Return-path MX | MX | `send.email` | `feedback-smtp.eu-west-1.amazonses.com` | 10 |
| Return-path SPF | TXT | `send.email` | `v=spf1 include:amazonses.com ~all` | — |
| Tracking | CNAME | `links.email` | `links1.resend-dns.com` | — |

Namecheap's API ignores an additional MX record while the zone uses its automatic `Private Email` mode. Following Namecheap's documented multi-provider setup, Mail Settings was changed to `Custom MX` with the same root delivery targets (`mx1.privateemail.com` and `mx2.privateemail.com`, priority 10). The previously missing root SPF record (`v=spf1 include:spf.privateemail.com ~all`) was also added. Both authoritative nameservers, Cloudflare DNS, and Google DNS confirm the Shopify A record, both Private Email MX records, Private Email SPF, and all four Resend records. Resend confirms DKIM, SPF, return-path MX, and the custom tracking CNAME as verified.

## Identity and lifecycle limits

Welcome triggers only from explicit Shopify marketing consent. Browse/cart flows remain disabled for general visitors until the existing first-party storefront/PostHog session can be linked to a consented email reliably. Anonymous browsing never invents or exposes an identity.

Purchase is the global stop signal. Checkout recovery is keyed by checkout ID, never by email alone. Long replenishment delays are scheduled in D1 instead of keeping month-long Resend runs alive.

## Free-tier monitoring

The bridge enforces local and provider-reported quota guards and sends owner alerts around 70/90 emails per day, 2,400 emails per month, and 9,000 automation runs per month. At the production-readiness checkpoint, D1 recorded 2 emails for the day/month and 9 automation runs for the month. Dispatch was allowed and no warning or critical threshold was active; the live health endpoint is the current source.

## Open-source research applied

The implementation adopts independently implemented patterns from Dittofeed, Novu, Mautic, Plunk, Listmonk, Trigger.dev, Svix, Klaviyo, Omnisend, and PostHog: durable event ledgers, checkout-keyed idempotency, dispatch-time exit conditions, global stage suppression, stable experiment assignment, signed webhooks, conservative retry semantics, and Shopify-as-revenue-truth. It does not add a second heavyweight automation stack or copy incompatible/proprietary code. See `research/open-source-lifecycle-findings.md`.

## Go-live result

There is no remaining production blocker for the four enabled flows. The first production Cron completed successfully at `2026-09-08T19:20:17.000Z`: abandoned checkout, paid-order, and consent synchronization all returned `OK`; dispatch reported zero due sends, quota dispatch remained allowed, and there were zero open errors. No historical checkout entered a production flow. Browse Abandonment and Abandoned Cart remain paused by design until reliable consented identity exists.
