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
