# CJ pricing — why the dashboard's "Product cost" is wrong, and why fixing it keeps failing

**Date:** 2026-09-17 · **Scope:** the Funnel Builder Overview tile *"Product cost — What CJ charges for these orders"* and everything that feeds it · **Method:** live reads of the CJ API (order list, order detail, COGS, freight), the Worker's D1 ledger, Shopify Admin, every copy of the app on this machine, GitHub, the Cloudflare deployment log, and CJ's own documentation. No code was changed.

---

## 1. The answer in one screen

**What CJ charges** for a NovaHair sale is known, stable and small: a 4-bottle order is **$34.13 = $6.06 goods + $28.07 postage**; a 2-bottle order is **$20.20 = $3.42 + $16.78**. Goods are $1.32 a bottle; **postage is ~82% of the cost.** CJ's post-payment COGS endpoint returned *exactly* the pre-payment quote in every order checked — so Harel's rule is the right one: **cost is the quote at order creation (goods + shipping + add-ons), not what has been paid.**

**Why the tile said $327.37 today** for 5 sales whose real cost is ~$157: the ledger holds **10 cost rows dated today**. Six of them are orders **#4414–#4423 from September 7–9**, already shipped on paid `RESCUE-` orders. At 02:11 UTC the Worker's "missing order" sweep decided they were missing, created **six duplicate, unpaid `AUTO-` orders on CJ** for parcels that had already left the warehouse, "verified" them, and wrote their $34.13 each into **today**. Those six duplicates are sitting in CJ's cart right now — **paying them costs $204.78 for nothing.**

**Why every developer's fix "doesn't work":** there is no single copy of this code. Two full clones and about ten worktrees exist on this laptop; **eleven** copies of the cost matcher; the code that is actually live in production exists in *one* unregistered worktree and **is not on GitHub master at all** (master doesn't even contain the file). The Worker was deployed **four times today between 11:35 and 11:46 UTC** from a folder Cloudflare can't name, and today's ledger rows were written by **two different versions of the code** (one shape at 02:13, another at 13:02). A fix made in one folder is silently undone the next time someone deploys from another.

Everything below is the evidence.

---

## 2. What CJ actually charges (the price anatomy)

### 2.1 Real orders, read from CJ's API today

| CJ order | Shopify | Basket | Goods | Postage | **Total** | Weight | Paid? |
|---|---|---|---|---|---|---|---|
| AUTO-4485 | #4485 | 4 × dark brown + kit | 6.06 | 28.07 | **34.13** | 1430 g | no (CREATED) |
| AUTO-4484 | #4484 | 2 black + 2 dark brown + kit | 6.06 | 28.07 | **34.13** | 1430 g | no |
| RESCUE-4469 | #4469 | 2 black + 2 medium brown + kit | 6.06 | 28.07 | **34.13** | 1430 g | yes, 09-16 |
| RESCUE-4461 | #4461 | 2 black + 2 light brown + kit | 6.06 | **32.67** | **38.73** | 1430 g | yes — *"YP Special Line **To Door**"* |
| RESCUE-4468 | #4468 | 2 medium brown + kit + gloss + serum + mask | 6.98 | 33.77 | **40.75** | 1578 g | yes |
| MANUAL-4452 | #4452 | 2 medium + 2 light brown + kit + mask | 6.70 | **40.00** | **46.70** | 1998 g | yes |
| MANUAL-4448 | #4448 | 4 dark brown + kit + gloss + serum + mask | 9.62 | 45.18 | **54.80** | — | yes |
| RESCUE-4455 | #4455 | 2 dark brown + kit | 3.42 | 16.78 | **20.20** | — | yes |

Unit prices CJ is charging: **bottle $1.32** (every shade), **free kit $0.78**, hair-gloss spray $1.18, keratin serum $1.74, **argan mask $0.64 — but it weighs 568 g** and pushes the parcel into the next postage bracket (+$6–12). The ₪99.90 mask costs less than a dollar and more than ten to ship.

### 2.2 The quote *is* the charge — verified

CJ's COGS endpoint (`query_cogs`, which only has data after payment) returned for every paid order checked: total `g` = postage `f` + goods `h`, **identical to the `orderAmount` quoted when the order was created** (RESCUE-4469: 34.13 = 28.07 + 6.06; MANUAL-4452: 46.70 = 40.00 + 6.70; MANUAL-4448: 54.80 = 45.18 + 9.62; RESCUE-4455: 20.20 = 16.78 + 3.42). Four of four. There is no post-payment re-pricing in this account's history that I could find.

So the correct cost basis is exactly what Harel described: **CJ's `orderAmount` at creation, per Shopify order, for the exact basket including add-ons.** It is known the moment the CJ order exists, days before anyone pays.

### 2.3 Where CJ's numbers genuinely move (and the app must not assume)

- **Postage on identical baskets is not constant.** Across 36 four-bottle orders: 31 at $28.07, **5 at $32.67** (the *"To Door"* variant of the same line); across 13 two-bottle orders: 11 at $16.78, 2 at $21.28. Same goods, +16%. The line is chosen at creation by whoever/whatever created the order.
- **The freight calculator disagrees with the order.** CJ's `calculate_freight` for the identical basket to Israel *today* quotes **$33.30** (YP Special Line) / $38.33 (To Door) / $45.95 (Cosmetic Line) — the order created yesterday was quoted **$28.07**. A price pulled from the product page or the calculator is not the price of the order.
- **CJ's own docs say so.** The API reference defines `orderAmount`, `productAmount`, `postageAmount` as *"pre-payment estimates — values can change during order progression (creation → cart → confirmation → payment)"*, all in USD, and `actualPayment` as *"the amount actually paid… returned in create-order responses."* ([CJ API docs](https://developers.cjdropshipping.cn/en/api/api2/api/shopping.html))
- **Other merchants hit the same wall**: a Shopify-community thread reports CJ quoting ~$7 shipping on the product page and charging $30 at order time ([thread](https://community.shopify.com/t/why-is-my-cjdropshipping-products-shipping-cost-higher-than-expected/229682)); CJ documents that address or quantity changes re-price the order and offers an invoice template for "extra shipping fee" changes ([CJ help](https://cjdropshipping.com/article-details/How-to-Maintain-Product-Cost-for-CJ-3PL-Fulfillment)).

**Conclusion for the design:** record the quote **per CJ order at creation**, keep the goods/postage split, and if a payment ever differs, update the amount — never the date.

---

## 3. What the dashboard did today, row by row

The Overview tile sums `FinancialLedgerEntry` rows with `source = CJ_ORDER_COSTS` for the selected local days (`supplierCostForRange`, keyed by Shopify order GID). Today's rows, straight from the live D1 database:

| # | Shopify order | Sale date | Amount | Written at (UTC) | How it got there |
|---|---|---|---|---|---|
| 1 | #4414 | **Sep 7** | 34.13 | 02:13:51 | re-queued by the sweep → duplicate `AUTO-4414` created on CJ → cost dated *today* |
| 2 | #4415 | **Sep 7** | 34.13 | 02:13:55 | same — `RESCUE-4415` was already **paid Sep 9, shipped, out of warehouse Sep 12** |
| 3 | #4416 | **Sep 7** | 34.13 | 02:14:34 | same |
| 4 | #4419 | **Sep 8** | 34.13 | 02:15:16 | same |
| 5 | #4421 | **Sep 8** | 34.13 | 02:16:30 | same |
| 6 | #4423 | **Sep 9** | 34.13 | 02:17:45 | same |
| 7 | #4482 | today | 34.13 | 13:02:36 | *bundle price* — not at CJ yet, stuck `NEEDS_ADDRESS_FIX` (no postcode) |
| 8 | #4483 | today | 20.20 | 13:02:36 | *bundle price* — same, no postcode |
| 9 | #4484 | today | 34.13 | 13:02:36 | real `AUTO-4484` |
| 10 | #4485 | today | 34.13 | 13:02:36 | real `AUTO-4485` |
| — | **#4481** | today | **—** | — | **no row, no CJ order, no queue entry** — blonde, SKU `NOVASALE-4-0-0-0-0-0-0-4` (8 segments), the decoder returns null and nothing reports it |

Sum of rows 1–10 = **$327.37** — the tile. Rows 1–6 (**$204.78**) belong to a week ago. The honest number for today's five sales is rows 7–10 plus #4481 once it can be priced: **~$156.72**.

### 3.1 The trigger

`reconcileMissingCjOrders` (deployed code, `services/cj-order-backfill.ts`) runs from the Worker cron when `minute % 20 === 11` — it fired at **02:11 UTC**, and the ten pending rows for #4414–#4424 carry `firstSeenAt 02:11:27–02:11:31`. It builds the set of "orders CJ already has" from up to 3 pages of CJ's list, but the loop is `try { rows = await listCjOrders(page, 100) } catch { break }` — **a timeout silently truncates the set and everything older looks missing.** CJ *was* timing out in that window: #4417, #4418, #4420 and #4424 all failed their three create attempts with *"The operation was aborted due to timeout"* between 02:15 and 02:18. Six creates succeeded → six duplicates. `#4415` had no Shopify activity since Sep 9, so this was not a webhook.

### 3.2 Why the cost landed on today, not Sep 7–9

The verify path dates a cost row from `orderPayload.processed_at || created_at || verified_at`. The sweep replays a payload it rebuilds from GraphQL, which does not carry those snake-case fields, so it fell through to `verified_at` = now. And `persistFinancialLedgerEntries` upserts with `occurredDate = excluded.occurredDate` — **a re-verified order's cost physically moves to a new day.** Day totals are not stable; they can change retroactively whenever anything touches an old order.

### 3.3 Money at risk right now (not a reporting problem)

`AUTO-4414`, `AUTO-4415`, `AUTO-4416`, `AUTO-4419`, `AUTO-4421`, `AUTO-4423` are **unpaid duplicates in CJ's cart for parcels that already shipped.** The last bulk payment (25 orders at 11:02 UTC on Sep 16) paid every open order at once. If that happens again, **$204.78 is paid for six parcels nobody will send.** Trash them first (they carry the remark *"Auto NovaHair fulfillment for Shopify order #44xx"* and today's create date).

### 3.4 It was working — for eight days

| Day (Israel) | Paid sales | Cost rows | Ledger $ | $/sale |
|---|---|---|---|---|
| **09-17** | **5** | **10** | **327.37** | **65.47** |
| 09-16 | 12 | 11 | 347.57 | 28.96 |
| 09-15 | 14 | 14 | 414.46 | 29.60 |
| 09-14 | 12 | 12 | 410.21 | 34.18 |
| 09-13 | 3 | 3 | 93.06 | 31.02 |
| 09-12 | 3 | 3 | 88.46 | 29.49 |
| 09-11 | 5 | 5 | 142.79 | 28.56 |
| 09-10 | 3 | 3 | 88.46 | 29.49 |
| 09-09 | 4 | 4 | 150.65 | 37.66 |

From Sep 9 to Sep 16 the per-sale basis produced one row per sale at $29–38 — **correct.** The tile is not chronically wrong on this basis; it broke today, by the mechanism above, and it can break the same way any day a CJ list call times out.

---

## 4. Why it is "so hard to solve" — the structural causes

### 4.1 There is no single source of truth for the code

| Fact | Evidence |
|---|---|
| Two full clones of the repo | `Desktop\Shopify-Internal-Funnel-App` (branch `feat/railway-deploy-step1`, dirty, 20 modified files) and `Documents\Codex\2026-08-27\s\work\funnel-builder-support-live` (branch `feat/ai-support-live-20260908`) |
| ~10 worktrees / copies hanging off them | 4 registered on the Desktop clone, 3 on the support-live clone, plus release/bundle copies |
| **11 copies of `cj-cost-match.ts`** | 10 are the 28-line August original that matches on `platformOrderId` — a field CJ never populates for this store. **One** (`funnel-builder-gallery-antiflicker`) is the 116-line Sep-16 version that understands `AUTO-/RESCUE-/MANUAL-/BACKFILL-` |
| `reporting-currency.ts`, `fx.ts`, `cj-order-backfill.ts` exist in exactly one folder | that same worktree, branch `fix/order-webhook-reconciliation-20260908` |
| **GitHub `master` has none of this** | `origin/master` does not contain `cj-cost-match.ts`, `fx.ts` or the 6-shade decoder; last push 2026-09-16 |
| The Desktop checkout — the one memory says deploys go from — still has the August matcher | its `git log` shows the file changed once, on Aug 25 |
| **4 production deploys today, 11:35–11:46 UTC, "Source: Unknown"** | `wrangler deployments list` |
| Today's ledger rows were written by two code versions | rows at 02:13 carry `{orderNumber, costLabel}`; rows at 13:02 carry `{costBasis, costDetail, bundleSignature}` |

This is the actual answer to *"how come no matter how many developers work on it it's still wrong."* Each session fixes it in whatever folder it opened, deploys from there, and the next session — opening a different folder — deploys the old code back. The fixes are real; they don't accumulate.

### 4.2 Three definitions of "cost" live in one table, and two dashboards pick differently

| Stream | Written by | Keyed by | Dated by | Amount | Used by |
|---|---|---|---|---|---|
| `CJ_ORDER_COSTS` / `CJ_VARIABLE_COST` | per-sale verify + reconcile | **Shopify order GID** | Shopify sale date (or `verified_at` — see 3.2) | CJ `orderAmount` at creation | **Overview "Product cost"** (`supplierCostForRange`) |
| … with `costBasis: CJ_BUNDLE_PRICE` | reconcile | Shopify GID | sale date | last CJ order of the identical bundle | same tile (correct fallback for orders not yet at CJ) |
| `CJ_PAID_ORDERS` / `ACCOUNT_PAID_ORDER_COST` | `reconcileCjPaidCosts` | **CJ order id** | **CJ payment date** | `detail.actualPayment`, else `orderAmount` | **Growth Cockpit "profit"**, force-relabelled `ACTUAL` |

On Sep 16 the first stream says **$347.57** (11 sales) and the second says **$785.94** (25 CJ orders happened to be paid that day, for sales from Sep 13–15). Both are labelled "CJ cost." The owner sees two different numbers for the same day depending on the screen.

And the second stream is built on sand: **`getOrderDetail` never returns `actualPayment`** — checked on unpaid and on paid orders — so it *always* takes the fallback and marks it `ESTIMATE`; the route then overwrites the quality to `ACTUAL` with the note *"accepted by the operator."* Per Harel's rule (cost at creation, not at payment) this stream should not exist.

### 4.3 The SKU grammar grows with every colour, and every component hard-codes its width

`NOVASALE-{size}-{count per colour…}`: 5 colours → 6 segments (`NOVASALE-4-4-0-0-0-0`), 6 colours → 7 (`NOVASALE-4-0-0-4-0-0-0`, medium brown, added Sep 16), **7 colours → 8** (`NOVASALE-4-0-0-0-0-0-0-4`, golden blonde — sold and paid today as #4481). The new product `NOVAHAIR — שמפו צבע לשיער` has **1,162 variants** — exactly every multiset of 7 colours in sizes 2/4/6 (28 + 210 + 924). An 8th colour would make it 2,145.

The Worker's decoder accepts 6 and 7 segments (`REGEX_NOVASALE_LEGACY`, `REGEX_NOVASALE_SIX_SHADE`); `CJ_PHYSICAL_MAPPINGS` has six shades and no blonde vid; the Python worker has its own decoder. **An undecodable order is not queued, gets no cost row, and is reported nowhere** — #4481 is invisible to every screen. This is the third time this exact failure has happened (5→6 shades on Sep 16 per the memory notes; 6→7 today).

### 4.4 Three systems create CJ orders for the same sale

| Prefix | Created by | Channel (CJ COGS `n.f`) |
|---|---|---|
| `AUTO-` | Cloudflare Worker (TypeScript) | API |
| `RESCUE-` | Railway Python worker `cj-sync-worker` | API |
| `MANUAL-`, `BACKFILL-` | AI agents through the CJ MCP connector | **MCP** |
| `#4470` (no prefix) | CJ's Shopify store connection — an unpaid shadow with `orderAmount: null` | — (CJ's own UI lists these as **"Invalid Orders (117)"**) |

Results visible in the last 100 rows: #4461 has `AUTO-` (trashed) + `RESCUE-` (paid, $4.60 more postage); #4452 has `RESCUE-` (trashed) + `MANUAL-` (paid, $12.57 more — the mask was added); #4454 has **three** `RESCUE-` rows. Every duplicate is a chance for a different quote, a trash row, and a mismatched cost.

### 4.5 Add-ons are neither ordered nor costed by the automatic path

`buildNovaHairCjProductLines` maps only the seven bundle components (six bottles + kit). Orders that bought a bundle **plus** the mask, gloss, serum or scalp brush (#4475, #4476, #4468 and any future upsell) get an `AUTO-` order for the bottles only: `AUTO-4475` is $34.13 with goods $6.06 — the ₪99.90 mask is not in it. The customer paid for something that will not ship, and the cost tile is short the mask plus its postage. (The Sep-8 *"report missing NovaHair CJ add-ons"* fix went into the Python worker, not the Worker.)

### 4.6 Dates and money units are the last mile

- Quote time (CJ `createDate`), payment time (`paymentDate`), and sale time (Shopify `processed_at`) are three different days for the same order; CJ timestamps are UTC, the ledger is Asia/Jerusalem, the Desktop Overview JS picks its range in UTC.
- Revenue is ILS; cost is USD. The live conversion is **correct**: ₪1,121.10 × 0.32898 = $368.81, rate from open.er-api.com cached daily in `FxRateDaily`. (Payment fees at $21.33 = 5.8% of revenue look high for Shopify Payments IL — not CJ, but worth a look.)

---

## 5. What "correct" must mean before anyone writes code

**Definition (Harel's, confirmed by the data):** the cost of a Shopify sale is CJ's quoted `orderAmount` for the **one** CJ order that fulfils that sale's **exact basket** (bottles + kit + every add-on), captured **when that CJ order is created**, stated in USD, **dated by the Shopify sale date**, one row per sale, the date never rewritten. If CJ's charge at payment differs, the *amount* is updated and the quality flips to ACTUAL; the date stays. A sale with no CJ order yet is priced from the last CJ order of the identical basket and flagged as such (this exists and works). A sale that cannot be priced **must be visible** on the dashboard, not absent from it.

**Acceptance test that would have caught every failure above:** for each local day, `count(cost rows) == count(paid Shopify sales)` and no row's `occurredDate` differs from its order's sale date. Today fails both (10 ≠ 5; six rows off by a week).

---

## 6. Why the next fix will fail too, unless these come first

1. **One repo, one branch, one deploy path.** Pick a folder, merge `fix/order-webhook-reconciliation-20260908` to `master`, push, delete or archive the other copies, and make `npm run deploy` refuse to run outside that folder (or run it from CI). Until this exists, every fix is a coin flip against the next deploy.
2. **Kill the payment-date stream** (`reconcileCjPaidCosts`, `CJ_PAID_ORDERS`) and make both dashboards read the same per-sale ledger. Two numbers for one day is what "it's always wrong" looks like from the owner's chair.
3. **Make the "already at CJ" check fail closed.** If any list page fails, skip the sweep entirely — never re-order. And check for *any* purchase prefix, across enough pages to cover `LOOKBACK_DAYS`.
4. **Never overwrite `occurredDate` on upsert**, and date from Shopify's sale time from a payload field that actually exists in the replayed shape.
5. **One SKU decoder, shared, width-agnostic**, with the colour list read from the catalogue — and an undecodable paid order must raise an incident, not vanish.
6. **Add-ons in the AUTO order** (map every CJ SKU on the order, not just the bundle), so the parcel and the cost both include what the customer bought.
7. **One writer of CJ orders per sale.** Decide whether the Worker or the Python worker owns fulfilment; the other reads only. Agents creating `MANUAL-` orders through the MCP need to file them under the same idempotency key.

---

## 7. Do now, no code required

- **Trash `AUTO-4414`, `-4415`, `-4416`, `-4419`, `-4421`, `-4423` on CJ** before any bulk payment ($204.78).
- **#4481** (blonde, ₪215.10, paid): decide the shade's CJ source or refund; nothing will ship and nothing reports it.
- **#4417, #4418, #4420, #4424**: the sweep gave up on them after three timeouts; confirm their `RESCUE-` orders exist and are paid (they are outside the 100 rows I read).
- **#4482, #4483** (today) and **#4472, #4474, #4476, #4480** (yesterday) are held for a missing postcode — a third of yesterday's orders. The postcode field at checkout is the real fix; until then someone has to fill them in.
- **#4475, #4476, #4468**: add-ons not in the CJ order — add them manually or they will not ship.

---

## 8. Evidence trail

- CJ API: `shopping/order/list` (271 orders, pages 1–2 read), `getOrderDetail` for AUTO-4470, AUTO-4415, RESCUE-4415, RESCUE-4452, RESCUE-4461, RESCUE-4468, RESCUE-4469, MANUAL-4452; `query_cogs` on SD2609152328450661600, SD2609160126110659900, SD2609160126050662701, SD2609152249340642500; `calculate_freight` CN→IL for 4×`2412030839551624000` + kit.
- D1 (`shopify-funnel-control-db`, remote): `FinancialLedgerEntry` by day and the ten rows for 2026-09-17; `NovaHairPendingOrder` for #4414–#4424 and #4481–#4485; `FxRateDaily`.
- Shopify Admin GraphQL: orders #4455–#4485 with SKUs; order #4415 events; product 10341269274919 variant count and SKU lookup `NOVASALE-4-0-0-0-0-0-0-4`.
- Code: `app/cloudflare-pilot/src/{lib/cj-cost-match.ts, services/cj-paid-costs.ts, services/cj-cost-reconcile.ts, services/novahair-monitor.ts, services/cj-order-backfill.ts, lib/financial-ledger.ts, lib/fx.ts, lib/reporting-currency.ts, routes/growth-cockpit.ts}` in both the Desktop checkout and `funnel-builder-gallery-antiflicker`; `cj-sync-worker/*.py`; `app/admin/js/overview.js`.
- Cloudflare: `wrangler deployments list --name shopify-funnel-control`.
- Git: `git worktree list` on both clones; `git log --all` on the cost files; `origin/master` contents.
- External: CJ API reference (money-field definitions and status lifecycle), Shopify community thread on CJ shipping quotes, CJ help article on product-cost maintenance, open.er-api.com ILS→USD.


---

## 9. What changed on 2026-09-17 (the fix, in two phases)

Everything above described the disease. This section is the treatment that was deployed the
same day, so the next person does not have to rediscover either.

### Phase 1 — one door to production (done, live at 11:xx UTC as `a87c30e93136`)

- `master` now carries the code that is actually live; the unregistered worktree that held it
  was merged (`7bf63693`), and every other copy of the app on the laptop carries a
  `DO-NOT-DEPLOY` marker.
- `npm run deploy` goes through `scripts/deploy-guard.mjs`: clean tree, `master`, `HEAD ==
  origin/master`, build, refuse if the build changed a tracked file, then `wrangler deploy` with
  `BUILD_SHA/BRANCH/TIME/FROM` injected. `GET /api/version` answers "what is live".
- See `DEPLOYING.md`.

### Phase 2 — the Worker owns CJ, and the ledger is checked every morning

Decisions Harel made: "Ledger only, leave CJ" (he trashes the duplicate CJ orders himself),
"Yes, consolidate", "The Worker owns it".

| Cause (section 4) | Change | Where |
|---|---|---|
| The sweep acted on a half-read CJ list and placed six duplicate orders | The CJ list is read back to the start of the window; a failed page or a cut-off list **skips the whole sweep** (`skipped: cj_list_failed / cj_list_incomplete`) | `lib/cj-order-index.ts`, `services/cj-order-backfill.ts` |
| The queue only looked for `AUTO-` on page one before creating | Before creating, the queue reads CJ back to the sale itself and **adopts** any purchased order under any prefix (`RESCUE-`, `MANUAL-`, `BACKFILL-`); a partial read throws and nothing is created | `findPurchasedCjOrder` in `services/novahair-monitor.ts` |
| Costs were re-dated to "when the code ran" | `orderPayloadForFulfilment` now carries `processed_at`/`created_at`; `recordSupplierCost` dates only from those and otherwise leaves the row to the reconciler; both writers store the same row shape (`costBasis: CJ_ORDER`, quality ACTUAL, CJ order total = product + postage, paid or not) | `lib/shopify-admin.ts`, `services/novahair-monitor.ts` |
| Two cost definitions in one ledger (`CJ_PAID_ORDERS` by CJ payment date, built on a field CJ never returns) | Stream retired: writer, cron task, cockpit reads, UI button, definition. Old rows are left in D1 untouched. Operations now judges freshness by `CJ_ORDER_COSTS` | `services/cj-paid-costs.ts` (deleted), `growth-cockpit-reconcile.ts`, `worker.ts`, `routes/growth-cockpit.ts`, `routes/operations.ts`, admin JS/HTML |
| SKU grammar widens with every colour; Golden Blonde (#4481) was invisible | 7-colour SKUs decode (blonde last, verified against the catalogue); blonde has **no CJ variant**, so the order is parked as `NEEDS_SUPPLIER_MAPPING` and shown in Operations, the morning digest and the audit — never silently dropped. A parked order releases itself once a mapping lands in code | `lib/novahair-cj-auto-order.ts`, `lib/supplier-order-plan.ts`, sweep release step |
| Add-ons never in the AUTO order (#4468, #4475, #4476) | Mask, gloss, serum and brush are mapped to their CJ vids (read from CJ on 2026-09-17) and travel in the same CJ order; verification counts them; an unmapped `CJ…` SKU parks the order | `CJ_ADDON_MAPPINGS` |
| The extra-bottle upsell (`NOVAEXTRA-2-black-black`, first seen on #4486 today) was unknown to every writer | Decoded and folded into the parcel (six bottles, not four); the parcel is re-planned from the order's own lines on every queue attempt, so #4486 ships right once its postcode is fixed | `decodeExtraBottlesSku`, `planSupplierOrder`, queue re-plan |
| Nobody checked the ledger against the sales | Daily audit: sales vs ledger rows vs CJ list — unpriced sales, rows dated on the wrong day, sales with two CJ orders, orders waiting for a mapping. In the 07:00 digest and at `GET /api/growth-cockpit/cj-cost-audit?days=7`; the cockpit's "Re-check CJ costs" button runs reconcile + audit | `lib/cj-cost-audit.ts`, `services/cj-cost-audit.ts`, `services/owner-digest.ts` |
| Three writers | Railway worker: `SYNC_CREATE_ORDERS` gate, default off (tracking sync and shipment snapshot keep running). Agents: memory rule, no `MANUAL-` orders | `cj-sync-worker/worker.py`, README |

Tests: 393 Worker tests (`npm test`), 27 Python tests; new files `test/supplier-order-plan.test.ts`,
`test/cj-order-index.test.ts`, `test/cj-cost-audit.test.ts`, `test/cj-cost-forever.test.ts` (source
pins for every invariant above), `cj-sync-worker/tests/test_worker_gate.py`.

### What is deliberately *not* done

- The `occurredDate` column is still overwritten on upsert. The reconciler is the corrector
  (it dates from Shopify's `processedAt`), and the audit reports any row whose date disagrees
  with its sale; freezing the date would make a wrong first write permanent.
- Golden Blonde still has no supplier. Until Harel sources it or removes the variant, every
  blonde sale parks as `NEEDS_SUPPLIER_MAPPING`.
- Old `CJ_PAID_ORDERS` rows stay in D1; nothing reads them.
- The six duplicate `AUTO-4414/15/16/19/21/23` orders are Harel's to trash at CJ; the audit
  lists them every morning until he does.
