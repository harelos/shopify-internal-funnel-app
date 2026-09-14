# Phase 1 status — 14 Sep 2026

Port the funnel's converting blocks onto a real product template. No page builder.

---

## What the theme audit turned up

The reason product pages never improved is architectural. The theme already carries
**six hand-built PDP sections, one per product**:

| Section | Size |
|---|---|
| `sections/ideo-v3-pdp.liquid` | 55.6 KB |
| `sections/novahair-pdp-v2.liquid` | 37.4 KB |
| `sections/hairloss-pdp-staging.liquid` | 34.1 KB |
| `sections/hairloss-pdp.liquid` | 34.0 KB |
| `sections/elasticdream-cro-pdp.liquid` | 33.8 KB |
| `sections/ideo-skin-memory-pdp.liquid` | 33.6 KB |

Plus roughly **40 GemPages `gp-section-*` files**, several over 100 KB
(`gp-section-570419091416810720.liquid` is 166 KB).

So adding a product has meant rebuilding a page from scratch, which is why 80-odd
products still sit on stock Dawn. Building a seventh bespoke section would have
repeated the mistake.

## What was built instead

**One** section that any product can use, driven by product data and metafields.

- `theme-src/sections/nova-pdp.liquid` — 27.5 KB, replaces the per-product pattern
- `theme-src/assets/nova-pdp.css` — 14.3 KB, tokens taken from the 4.03% sales page
- `theme-src/assets/nova-pdp.js` — 7.5 KB, no dependencies
- `theme-src/templates/product.nova.json` — the template wiring

Blocks, in the funnel's order: trust bar, gallery (first in DOM **and** first on
mobile), rating, title, price with savings badge, benefit chips, shade picker or
pack ladder, CTA, reassurance strip, routine, details/FAQ accordion, sticky mobile
buy bar.

### The pack ladder detects itself

The single biggest lever on the funnel is the bundle ladder with a falling
per-unit price. Rather than a setting per product, the section inspects the option
values: **an option becomes a ladder when it has 2+ values and every value carries
a number**. `1+1 / 2+2 / 3+3` becomes a ladder; `שחור / חום` stays a shade picker.
One template covers the catalogue.

Pack size is summed, not guessed. An Israeli `2+2` is two paid plus two free, so
the pack holds four. Taking the first number instead would have printed a per-unit
price that is not true, and that was a real bug caught in preview and fixed.

Verified live on the OCEAURA shampoo, computed entirely from real variant prices:

| Pack | Total | Was | Saving | Per unit |
|---|---|---|---|---|
| 1+1 | 131.44 | 198.69 | 34% | 65.72 |
| 2+2 | 210.91 | 351.52 | 40% | 52.72 |
| 3+3 | 272.05 | 473.79 | 43% | 45.34 |

### Nothing is invented

Prices, savings and per-unit figures are all derived from the variants. The star
rating renders **only** when `nova.rating` holds a real number, so the page can
never ship a placeholder review count.

## Verified in preview

Theme `188482584871`, mobile 375×812 and desktop:

- Gallery renders above the title on mobile, scroll-snap carousel + thumbnails
- Shade pills for non-numeric options, quantity stepper when there is no ladder
- Selecting a pack updates price, compare-at, savings badge, sticky bar, hidden
  variant input and the `?variant=` URL
- Sticky buy bar appears past the main CTA and submits the same form
- No horizontal overflow at 375px (`scrollWidth === clientWidth === 375`)
- No console errors from the section

## Metafields created

Six `nova` definitions now exist on products, so content is editable from the
product admin with no code and no new template:

`nova.subtitle`, `nova.chips`, `nova.steps` (`Title | Text`),
`nova.faq` (`Question | Answer`), `nova.rating`, `nova.rating_count`.

---

## Deploying to live

The Admin API blocks writes to the live theme, so these four files get pasted once
in **Online Store → Themes → Updated copy of Dawn → Edit code**. All four are
**new files** — nothing existing is modified, so there is no merge risk:

1. `assets/nova-pdp.css`
2. `assets/nova-pdp.js`
3. `sections/nova-pdp.liquid`
4. `templates/product.nova.json`

Then switch products over one at a time by setting the product's template to
`nova` in the product admin (Online store → Theme template). Start with the
root-cover powder and the OCEAURA shampoo, watch conversion, then move the rest.

**Do not publish theme `188482584871`** ("LIVE Copy - Agent Ready Safe Release
2026-09-03"). Despite the name it is not a clean copy of live: its
`snippets/country-localization.liquid` is an outdated 4,691 bytes against live's
5,944 and throws a **visible Liquid syntax error** on desktop, and its
`settings_data.json` is behind live. It is fine as a preview sandbox and unsafe as
a release candidate.

## Still open from Phase 0

Unchanged and still worth doing: money format still renders `131.44 NIS` instead of
`₪131.44` (Settings → General, no API for it), the popup's English placeholder, and
repointing the losing 7-reasons ad sets.

---

# Above-the-fold pass — 14 Sep 2026

Grounded in Baymard's Product Page UX research (30,000+ usability scores, 110+ PDP
guidelines; only 38% of mobile sites rate "decent" or better) and their
Consideration & Purchase study, where **60% of users look for the return policy on
the product page itself**.

Baymard's first-viewport set is: title, price, star rating, key variant selector,
one primary CTA, and a one-line delivery/returns promise. The buy box had the
first five. It was missing the delivery and returns layer entirely.

## Added

| Element | Where the data comes from |
|---|---|
| Estimated delivery window | Computed dates from two theme settings, labelled an estimate, not a promise |
| Shipping note beside the dates | Theme setting |
| Accepted payment marks | `shop.enabled_payment_types` — cannot advertise a method checkout does not take |
| Direct links to shipping and refund policy | The store's real policy pages, rendered only when the policy has content |
| Low stock line | Real tracked inventory of the selected variant, at or below a threshold |
| Sticky buy bar from first paint | Shows whenever the real Add to cart is off screen |

## On the low stock line

It reads `inventory_quantity` of the selected variant and stays hidden unless the
number genuinely sits at or below the threshold. With CJ stock in the thousands it
**never appears**, which is the correct behaviour. It is not a countdown, not a
"47 people are viewing", and it never invents a number.

That is deliberate. The research is blunt: merchants who use both fake and real
scarcity end up converting **worse than merchants who use neither**, because the
fake version destroys the trust the real version depends on.

## Measured after, 375×812

- Announcement bar: one line, 304px span in a 315px container
- Delivery box: one line, 343px wide, 39px tall
- Payment marks: 10, single row. Policy links: single row
- Sticky buy bar: visible from first paint, stays through scroll
- No horizontal overflow, no console errors from the section

## Deployment verdict

A full checksum diff of the staging theme against live settles it: staging is
**missing 12 files that exist on live** (`nh-mobile-*.png`, `nh-gallery-10-colorist*`,
`novahair-classic-commerce-config.js`, `novahair-full-page-experiment.js`,
`novahair-live-sticky-visibility-fix.css/js`) and two more differ
(`component-menu-drawer.css`, `novahair-funnel-variant-map.js`). It can never be
published. The only safe path to live remains pasting the four new files into the
live theme, which is additive and touches nothing existing.

---

# Protected pages and the corrected preview model — 14 Sep 2026

## Two pages must never be switched to the nova template

**ElasticDream** (`מסיכת-קולגן-לילה-elasticdream`, id `9671746683175`) has an empty
`templateSuffix`, so it looks like a default-template product. It is not. Line 1 of
`sections/main-product.liquid` hard-branches it:

```liquid
{% if product.id == 9671746683175 or product.handle contains 'elasticdream' or product.handle contains 'אלסטידרים' %}{% render 'elasticdream-cro-pdp' %}{% endif %}
{% unless product.id == 9671746683175 or ... %}
  ...the entire normal product page, lines 2-750...
{% endunless %}
```

**BiotinRoot** (`biotinroot-hair-loss-spray`) uses `templateSuffix: hairloss-pdp`,
and the staging copy uses `hairloss-pdp-staging`. Both have their own templates and
sections and were never affected.

Also on custom templates and out of scope: the NovaHair kit (`novahair-v4`) and
IDEO (`ideo-v3`, archived).

## The preview model was wrong and is fixed

Overwriting the preview theme's `templates/product.json` with nova made every
default-template product render nova, which silently bypassed ElasticDream's
custom page. That is exactly the regression to avoid.

`templates/product.json` in the preview theme has been restored to the live
version, so **preview now matches live for every product**. Nova is previewed
on demand instead:

```
/products/<handle>?view=nova
```

`?view=` renders `templates/product.nova.json` for that one request without
touching product data, so nothing is switched until it is deliberately switched.
The same URL works on the live theme once the four files are pasted in, which
means the new page can be checked against real products before any product is
migrated.

## Mobile health of the two protected pages

Measured on the live theme at 375×812:

| | ElasticDream | BiotinRoot |
|---|---|---|
| Horizontal overflow | none (375 = 375) | none (375 = 375) |
| Page height | 4,170px | 8,967px |
| Images | 29 | 22 |
| Tap targets under 40px | 9 of 111 | 7 of 118 |

No defects worth touching. The elements my scan flagged as overflowing are the
closed cart drawer and menu submenu parked off-canvas, which is correct behaviour.
The handful of small tap targets are shared header and footer links, not page
content. **Recommendation: leave both pages alone.**

---

# Truthful savings — 14 Sep 2026

Auditing every live product's pricing exposed a bug in this section and a broader
honesty problem.

## The bug: millilitres were being counted as bottles

The unit parser summed every number it found. On Copper Peptide that meant:

| Variant | Parser read | Printed | Reality |
|---|---|---|---|
| `מארז זוגי 1+1 (60 מ"ל)` | 1+1+60 = **62** | ₪2.26/unit, "97% off" | 2 bottles |
| `מארז 3 בקבוקים 2+1 חינם (90 מ"ל)` | 3+2+1+90 = **96** | ₪1.89/unit, "98% off" | 3 bottles |

Fixed. The parser now drops anything in brackets (a volume, not a count), ignores
values that only state a volume, and when the value already names its own count
(`3 בקבוקים 2+1 חינם`) that stated count wins over the promo arithmetic.

## The honesty problem: savings were measured against compare-at

A compare-at price is only meaningful if it was genuinely charged. Two changes:

**Pack badges now measure the real thing.** The saving is computed against what she
would pay buying the smallest pack repeatedly, using only this product's own
prices. True by construction.

| | Was (vs compare-at) | Now (vs real单 price) |
|---|---|---|
| OCEAURA 2+2 | 40% | **20%** |
| OCEAURA 3+3 | 43% | **31%** |
| Copper 1+1 | 31% | **15%** |
| Copper 3-pack | 37% | **26%** |

**Crossed-out prices are off by default.** The strikethrough and the `% off` badge
now render only when the product has `nova.compare_at_verified` ticked, a new
boolean metafield. Unset means no crossed-out price anywhere on the page. Tick it
only on products where the higher price was really charged.

Verified on the preview: OCEAURA shows 20% / 31% with no strikethrough, Copper
Peptide shows ₪70.15 and ₪60.62 per bottle at 15% / 26%.

---

# NovaHair site product page — 14 Sep 2026

The funnel was not touched. Only product `9882294354215`
(`novahair-שמפו-לצביעת-שיער-הצעה-חדשה`), the site listing, was changed.

## Gallery

Seven images taken from the funnel gallery, chosen to carry **no package or offer
numbers**. Excluded on purpose:

| Image | Why excluded |
|---|---|
| `novahair-gallery-v1-06` | "4 בקבוקים ב-239 ₪ / 59.75 ₪ לבקבוק" — offer pricing |
| `novahair-gallery-v1-07` | "4 בקבוקים + ערכת צביעה במתנה" — package offer |
| `novahair-gallery-v1-05` | bundle-mixing concept, meaningless on a single bottle |

Two existing images were removed because they sit on **black backgrounds**, which
render as black squares in the white `contain` tiles and break the consistency
across products. The files remain in Shopify Files and can be re-added.

Final order: hook → shades → 10 minutes → how-to → five per-shade shots →
two testimonials → service strip. 12 images, featured image is now the hook shot.

## A bug this surfaced

The gallery opened on slide 5 instead of the hero, because the default שחור
variant has that swatch as its featured image and `update()` followed it on first
paint. Now the gallery follows the variant image only after the shopper actively
picks a shade. Also fixed the scroll-to-thumbnail mapping, which divided by the
track width instead of the slide stride and drifted by one after a few slides.

## True numbers

No change to price data. The template already suppresses a crossed-out price and a
percentage badge unless `nova.compare_at_verified` is ticked, so the page now shows
a clean ₪130.18 instead of a ₪199.82 strikethrough that nobody was ever charged.

## Two things for the owner to decide

1. **Shade pricing is inconsistent**: שחור is ₪130.18 while the other five shades
   are ₪143.67, for the same bottle. Probably unintended.
2. `novahair-gallery-v1-08` carries a **"60 ימי אחריות"** claim. It is the brand's
   own funnel claim, but confirm it applies to site orders before this ships.

## Template switch

Verified safe: requesting `?view=zzz-does-not-exist` returns **200 with the default
template**, so Shopify falls back gracefully when an alternate template is missing.
Setting `templateSuffix` to `nova` therefore cannot break the live page. It should
still be done at the same time as the file paste, otherwise the product renders
stock Dawn in the gap, which is worse than what it has now.
