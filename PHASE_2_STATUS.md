# Phase 2 — catalogue import and the September promotion

Everything below is **live in the Shopify admin and invisible to customers**.
55 products are DRAFT, the promotion page is unpublished, and the discounts are
scheduled against products nobody can see yet. Publishing is a separate decision.

---

## 1. What went in

**55 products**, created as DRAFT, on the `nova` product template, each with a
Hebrew title, Hebrew description, Hebrew SEO title and meta description, a Latin
URL handle, one background-removed product photo on a uniform tile, tags, product
type, vendor, and the CJ unit cost recorded against the variant.

| shelf | count | vendor |
|---|---|---|
| צביעה וכיסוי שורשים | 6 | NovaHair |
| טיפוח שיער / עיצוב שיער | 19 | NovaHair |
| טיפוח קרקפת | 13 | NovaHair |
| אביזרי שיער | 6 | NovaHair |
| טיפוח פנים / הגנה מהשמש / טיפוח גוף | 11 | NovaGlow |

Prices run ₪45 to ₪149, mean ₪102. Mean gross margin **83%**, computed against
CJ cost plus weight-based shipping to Israel at ₪3.02/USD. That matches the
80–97% the store historically ran on CJ goods.

**Two brands.** Hair is NovaHair. Skin is **NovaGlow**, a new sibling name,
because "NovaHair" on a face serum reads wrong. Both sit under TigerBrandsGlobal.

**Five smart collections**, rule-driven on product type so future products file
themselves: `hair-color`, `hair-care`, `scalp-care`, `hair-tools`, `skin-care`.
Each has its own Hebrew SEO title and description, because the collection page is
usually what ranks for a category search rather than any single product.

---

## 2. How the products were chosen

Harvested **~27,000 CJ listings** across the beauty categories and 90 keyword
sweeps, then filtered in three passes.

**Listing filter.** Proven seller (`listedNum`), sane price band, named supplier,
and two hard exclusions:

- **Anything powered.** CJ ships type-A plugs and 110V units; Israel is type-H at
  230V. A device that arrives with the wrong plug is a return and a bad review.
  That removed every straightener, hot-air brush, facial steamer and LED mask.
- **Anything regulated.** A minoxidil spray and a laser "hair therapy" comb both
  made the shortlist on their sales numbers. Both are out. Minoxidil is a
  registered medicine in Israel and the laser comb is a medical-device claim.

**Image filter.** CJ's first photo is almost always a marketing banner: a model,
a before/after pair, ingredient bubbles, English advertising copy. The pipeline
pulls the whole image set, scores every photo, and takes the best packshot:

- rejects any frame with meaningful skin tone (models, hands, scalp photos)
- rejects collages by counting flat seam lines
- rejects spec sheets and ad overlays by counting text-like marks that sit
  **outside** the product's bounding box. Text printed on the bottle is a label
  and is fine; lines of English laid out on the empty white beside it are not
- prefers earlier positions in the set, because CJ pads the tail with accessories
  (this was a real bug: a rosemary oil listing's cleanest photo was a scalp
  massager that shipped with it)

The chosen photo is then cut out with `rembg`, stray blobs are dropped, and the
subject is composed on a 1200×1200 `#faf7f2` tile at a fixed margin, so a tall
bottle and a wide jar carry the same visual weight.

**My own eye.** I reviewed all 84 survivors on contact sheets and cut 29 more:
party colours and glitter (wrong customer), tiles where the cut-out left props or
callout arrows, and a "whitening" underarm cream.

### One finding worth acting on

**CJ cannot supply a hair-colour shelf.** Out of ~18,000 hair listings harvested,
only **82** were hair colour at all, and barely a handful were proven sellers.
That is why colour is 6 products and not 15. Given colour is what actually brings
this store its traffic, the depth has to come from a different supplier. The
catalogue is therefore weighted to the maintenance a colour customer repurchases,
which is a real business, but it is not the same as owning the colour category.

---

## 3. The September promotion

**שבועיים של טיפוח**, 15–30 September, on `/pages/deals` (unpublished).

Structure is Ulta's *21 Days of Beauty*, which is the proven mechanic: one hero
offer that changes daily, a running weekly offer underneath, and the next days
visible so there is a reason to come back. Ulta runs 28 Aug–17 Sep at 50% off and
Sephora mirrors it.

**The depth is not borrowed.** 50% works for a retailer discounting someone
else's brand. Here a standing half-price trains the customer to wait, and these
products have no price history to discount from honestly. Daily heroes sit at
**25–30%**, the weekly collection offer at **20%**.

**The calendar is Israeli, not American.** Tishrei falls almost entirely inside
September 2026:

| | |
|---|---|
| 11–13 Sep | ראש השנה (past) |
| 15–19 Sep | between the holidays, people restock |
| **20–21 Sep** | **יום כיפור — the store goes dark** |
| 22–24 Sep | after the fast, pre-Sukkot |
| 25 Sep | ערב סוכות |
| 26–30 Sep | חג וחול המועד |

The two dark days carry no offer, no email and no ads. The page shows a quiet
holding state instead. A beauty sale running through Yom Kippur is the kind of
thing an Israeli customer remembers about a brand.

### How it rotates

Nothing has to happen at midnight, which is the point:

- the schedule is a shop metafield `nova.promo_calendar`
- `sections/nova-deals.liquid` reads it and picks today's row **on every
  request**, so the page rotates itself
- the real price change is **16 Shopify automatic discounts**, already created,
  each with its own `startsAt`/`endsAt` in Asia/Jerusalem. Shopify switches them

If the scheduled agent never runs, September still works correctly.

### Verified

| state | result |
|---|---|
| before the run starts | closed state, correct |
| a live deal day | ₪79.90 → **₪55.93**, "חיסכון ₪23.97" — exact |
| dark day | quiet state, next live date shown |
| hero unavailable | falls back rather than advertising a dead offer |
| upcoming list, weekly offer, full schedule | all render |
| 375px mobile | one-line CTA, no horizontal scroll |

### The scheduled agent

`novahair-promo-rotation`, daily at 07:37 local. It **verifies rather than
rotates**: that today's hero is published and available, that the discount exists
at the percentage the page advertises, that no discount is live on a dark day,
and that the calendar has not nearly run out. It builds the next month when fewer
than four days remain. It is explicitly forbidden from publishing anything,
touching the funnel, or changing prices.

---

## 4. Also fixed

**The Foundry vault was broken for every agent on this machine.** Something
rewrote `~/.foundry-vault/secrets.dpapi` at 15:58 with a UTF-8 BOM in front of
the `dpapi:v1:` prefix, so `foundry-vault.js` threw `Unsupported vault
encryption` on every read. I backed the file up and stripped exactly those three
bytes; all 42 secrets read normally again. Almost certainly a PowerShell writer
defaulting to BOM output. Worth finding, because it will recur.

---

## 5. What is waiting on you

1. **Publishing.** All 55 products and `/pages/deals` are unpublished by design.
   Nothing reaches a customer until you publish, and the promotion only becomes
   real at that moment.
2. **Colour depth.** CJ cannot supply it. Worth sourcing separately if colour is
   to stay the front of the store.
3. Carried over and still open: the money format in Settings → General is still
   `{{amount}} NIS` (there is no API for it, the PDP paints ₪ itself); the
   `theme-patches/base.css` mobile order fix is not applied; the email popup
   still shows an English `your@email.com` placeholder.

---

## 6. Where the code lives

| path | what |
|---|---|
| `theme-src/sections/nova-deals.liquid` | promotion page, self-rotating |
| `theme-src/assets/nova-deals.css` | its styles, NovaHair tokens |
| `theme-src/templates/page.deals.json` | the `deals` page template |
| `tools/promo/promo_calendar.py` | the schedule, with the reasoning inline |
| `tools/promo/deploy_promo.py` | writes calendar, discounts and page |
| `tools/promo/promo_check.py` | the daily verification |
| `tools/promo/run-check.sh` | what the scheduled agent runs |
| `tools/promo/imported-products.json` | the 55 products and their Shopify ids |

All three theme files are on live theme `182172320039`, verified byte-identical.
They are additive: the section and CSS are new files, and the template only binds
to `/pages/deals`, which is unpublished.
