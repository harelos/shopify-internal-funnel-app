# Operating this Worker

What a person needs to know before changing anything here.

## Deploying

```bash
npm test                 # 326 tests
npm run deploy:staging   # shopify-funnel-control-staging, sending disabled
npm run smoke:staging    # admin pages, auth, no stack leaks
npm run deploy           # production
npm run smoke            # the same checks plus the live storefront proxy
```

`npm run smoke` is not optional after anything under `/apps/funnels`. Mounting
the tracking page with `requireShopifySession` on that whole prefix once made
every storefront API call return 401 — popup, concierge and cart offers — for
hours, because the guard saw `/api/proxy-health` as its own sub-path and that is
not on the storefront allowlist. Unit tests cannot see a mount-order fault.

A new storefront endpoint must add its leaf path to `STOREFRONT_PROXY_PATHS` in
`src/lib/shopify-app-proxy-auth.ts`, and attach `requireShopifySession` to the
route rather than to the mount.

## Two applications share one D1 database

`shopify-funnel-control-db` holds about 93 tables and only some belong to this
Worker.

| Prefix | Owner | Touch from here? |
| --- | --- | --- |
| PascalCase (`Shop`, `SupportConversation`, `ShipmentOrderState`, `FinancialLedgerEntry`, `DashboardDailyMetric`, …) | this Worker | yes |
| `lifecycle_*`, `resend_*`, `abandoned_checkouts`, `storefront_lifecycle_*`, `suppressions`, `email_delivery_events` | the NovaHair lifecycle service | no |
| `CommentGuardian*`, `CommentResponse*` | the comment guardian (its secrets are on this Worker, its code is not) | no |

There is no point-in-time recovery configured. A migration that drops or
rewrites a table cannot be undone, and can break an application whose code is
not in this repository. Write additive migrations.

## Secrets

Nineteen secrets are bound to this Worker (`npx wrangler secret list`). Two
Shopify tokens exist on purpose and are not interchangeable:

- `SHOPIFY_ADMIN_ACCESS_TOKEN` — the Admin custom app. Refused the Customer
  object on this Shopify plan, so it cannot read an order's email, phone or
  name.
- the Funnel Builder app, reached through `customerGraphql()` /
  `SHOPIFY_PII_TOKEN` / client credentials. Anything touching customer data must
  go through `customerGraphql`, never `graphql` with the admin token.

They all live in one Worker with no rotation schedule: a leak of one is a leak
of all. Rotating `SHOPIFY_CLIENT_SECRET` also invalidates app-proxy signatures,
so the storefront endpoints must be smoke-tested straight after.

## Scheduled work

The cron runs every minute. Seven tasks run each time; the rest are gated on the
minute so they do not all hit external APIs at once.

| Task | When | Notes |
| --- | --- | --- |
| `processPendingQueueCron` | every minute | creates CJ orders; releases `NEEDS_ADDRESS_FIX` once an address is corrected |
| `reconcileGrowthCockpitCjOrderCosts` | every minute, 20-minute freshness gate | one supplier-cost row per sale |
| `processSupportDeskCron`, `processSupportOutbox` | every minute | drafting, then sending |
| `snapshotDashboardDaily` | `:x4` | settles the rows the trend chips read |
| `refreshShipmentTracking` | `:x2` of every 5 | re-reads CJ events, rescoring the board |
| `sendOwnerDigest` | `:x6` of every 15 | sends once, at 07:00 Israel |
| `processShipmentOutreach` | `:07`/`:37` | customer emails; capped and idempotent |
| `processCommentGuardian` | `:x3` of every 15 | answers and hides comments on the live Meta ads |

Anything that emails a customer is behind a flag: `SHIPMENT_OUTREACH_ENABLED`,
`SUPPORT_WORKER_SEND`, `OWNER_DIGEST_ENABLED`, and `COMMENT_GUARDIAN_ENABLED`
for anything posted in public. Staging sets all four to `false`.

### The ad-comment guardian

`COMMENT_GUARDIAN_MODE` is `shadow` or `live`. Shadow decides and records but
posts nothing; live posts at most 25 actions per run. It reads the comments on
every ACTIVE ad, on both Facebook and Instagram, decides with
`src/lib/comment-intent.ts`, and writes one row per comment to
`CommentGuardianComment`.

To see what it would say without it saying anything:

    POST /api/growth-cockpit/comment-guardian?shadow=true

which returns the decision and the exact reply for every comment it would act
on. `?shadow=true` suppresses that one run only; the stored mode is untouched.

It only answers what the store can stand behind: delivery, damage, "it did not
work", shades, shipping and thanks. Health, skin, pregnancy, ingredients,
regulatory approval, accusations, payment and price are **never** answered
automatically — they are counted as escalations and surface in
`/api/operations/health`. Comments pointing buyers at AliExpress are hidden
without a reply. Nothing is ever answered twice: a reply from the page, from a
person or from an earlier run all stop it.

## Money figures

- **Revenue and payment fees** come from Shopify, converted per day because the
  shop's currency changed mid-year. The D1 webhook ledger is a partial shadow
  (76 rows against 478 Shopify orders) and is only ever a labelled fallback —
  never treat it as the store's revenue.
- **Product cost** is one row per sale at the CJ order total, product plus the
  shipping CJ quoted. A sale CJ has not received yet is priced from the last CJ
  order of the identical bundle. The card says how many sales are covered. Do
  not reintroduce an average, and do not print the word "estimate": exactness
  here is the difference between a dashboard the owner trusts and one he does
  not.
- **Break-even CPA** is revenue minus product cost and payment fees, per order.
  `/api/growth-cockpit/ad-sets` judges each Meta ad set against it. Meta's
  purchase counts are Meta's own attribution and run well above the store's
  order count, so cost per purchase there is optimistic; the ranking is useful,
  the absolute number is not.

## Known sharp edges

- 72 `catch {}` blocks and 21 `.catch(() => null)` turn failures into "no data".
  The owner digest exists because of this; prefer surfacing an incident in
  `/api/operations/health` over swallowing.
- 179 `any` annotations, mostly in the older route files.
- Two sales funnels feed the CJ queue: NovaHair (`NOVASALE-` colour bundles) and
  OceAura (`OCEASALE-{shampoo}-{conditioner}-{oil}`, decoded by
  `src/lib/oceaura-cj-auto-order.ts`). Both ride `NovaHairPendingOrder`; an
  OceAura bundle carries its component lines and has no free kit.
- A second checkout of this repository on the Desktop deploys to the **same**
  Worker name. It holds an older comment guardian that only hid comments to
  keep a ratio and answered nobody. Deploy from this tree.
- 29 test files assert on source text rather than behaviour. They catch wiring
  regressions and nothing else; new tests should call the function.
- Railway hosts the shipment snapshot and its trial has expired, so that service
  cannot be redeployed. The Worker now rescores and refreshes tracking itself;
  what still depends on Railway is CJ order discovery and the Shopify status
  sweep.
