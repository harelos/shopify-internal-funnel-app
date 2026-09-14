# Phase 0 status — 14 Sep 2026

Store: `jacobfelipe.myshopify.com` / tigerbrandsglobal.com. Currency stays **ILS**.

---

## Done, live on the store

### 1. Collective catalog archived — 51 products

Not 33 as first estimated. The K-Beauty collection was only part of it; the full Shopify
Collective footprint was **51 products across 24 suppliers**, 37 of them still `Active` and
indexable, all at zero inventory, none with any revenue in 365 days.

Backed up first, in `catalog-archive/` (commit `2b58813`), then archived. Archiving is
reversible and the images stay in Shopify Files.

### 2. 51 URL redirects created

Split by category rather than dumped in one place:

- 7 hair products → `/collections/קולקציית-מוצרי-טיפוח-השיער-שלנו`
- 44 skincare / body → `/collections/מוצרי-טיפוח-פנים`

Spot-checked live: all resolve 200 to the right collection.

### 3. English option labels translated

These were the variant controls customers actually click, in English on a Hebrew store:

| Product | Was | Now |
|---|---|---|
| אבקת כיסוי שורשים מיידית | `Color` / **Black**, **Brown** | `גוון` / **שחור**, **חום** |
| סרום קרטין לשיער | `Capacity` / `50ml` | `נפח` / `50 מ"ל` |
| ספריי היירגלוס לשיער | `capacity` | `נפח` |
| שמן קיק שחור טהור | `Color` | `סוג` |

The root-cover powder was the bad one: its **shade picker**, the single most important control
on the page, read "Black / Brown".

---

## Built and verified, needs one manual step

### 4. Mobile PDP: product image was rendering below the whole info column

Diagnosed on the live page at 375px. The DOM order is correct; CSS was overriding it.
`assets/base.css` carries two hand-added RTL blocks that set:

```css
.product__media-wrapper { order: 2 !important; }
.product__info-wrapper  { order: 1 !important; }
```

with **no media query**. Intended as a desktop RTL fix, they also applied on mobile, so the
gallery was pushed to **1,459px** down the page. No product image above the fold at all.

Measured before and after (375×812, keratin serum page):

| | media top | info top |
|---|---|---|
| before | 1459px | 226px |
| after | **206px** | 693px |

Fix is in `theme-patches/`:
- `base.css` — the patched file
- `base.original.css` — live file as of today, md5 `dc094ab407d1a19901c1503253b5f70e`
- `mobile-pdp-media-order.patch` — the diff, 2 hunks, nothing else touched

**To apply:** Online Store → Themes → *Updated copy of Dawn* → Edit code → `assets/base.css`,
and wrap both blocks in `@media screen and (min-width: 750px) { … }` exactly as the patch shows.
Desktop RTL ordering is preserved; only mobile changes.

The Admin API blocks writes to the live theme by design, and duplicating the theme failed
because the store is at Shopify's theme limit (21 themes). Worth deleting some of the stale
preview themes — `Copy of Updated copy of Dawn` is from January and badly out of date.

---

## Still open, outside what the API can reach

### 5. Money format still reads `ILS 89.90`

Settings → General → Currency formatting. Change `{{amount}} NIS` to `₪{{amount}}` in both the
HTML with/without currency fields. There is no Admin API mutation for this; it is admin-only.

### 6. Email popup placeholder is English

The `EA • Email Popups` app still shows `your@email.com`. App settings, not theme code.

### 7. The 7-reasons split — do this in Ads Manager, not with a redirect

`/pages/novahair-7-reasons-staging` converts at **0.58%** against the sales page at **4.03%**,
on 172 sessions. That is a 7:1 loss and the test is finished.

I deliberately did **not** redirect that page. Meta checks the landing page of a live ad, and
redirecting a URL that active ads point at is a good way to get creatives flagged. Repoint the
ad sets to `/pages/novahair-sales-staging` instead, then retire the page.

---

## Correction to the strategy doc

The direction document says "33 K-beauty products". The real figure is **51 Collective
products**. Everything else in it holds.
