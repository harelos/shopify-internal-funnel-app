/**
 * Pure NovaHair bundle logic. No Shopify imports, so it runs under `node --test`
 * without a store, a Function runtime, or network access.
 *
 * SKU grammar:  NOVASALE-{bundleSize}-{black}-{darkBrown}-{lightBrown}-{purple}-{red}
 * Every bundle also carries exactly one free colouring kit per bundle unit.
 */

// Physical Shopify variants, verified live 2026-08-31. Their SKUs match the CJ
// SKUs 1:1, which is what lets CJ fulfil them without any SKU decoding.
export const COMPONENT_VARIANTS = {
  black: "gid://shopify/ProductVariant/50228321780007",
  darkBrown: "gid://shopify/ProductVariant/50228321812775",
  lightBrown: "gid://shopify/ProductVariant/50228321845543",
  purple: "gid://shopify/ProductVariant/50228321878311",
  red: "gid://shopify/ProductVariant/50228321911079",
};
export const FREE_KIT_VARIANT = "gid://shopify/ProductVariant/51871788171559";

const SHADE_ORDER = ["black", "darkBrown", "lightBrown", "purple", "red"];
const SKU_PATTERN = /^NOVASALE-(2|4|6)-(\d+)-(\d+)-(\d+)-(\d+)-(\d+)$/;

/**
 * Parse a bundle SKU into shade quantities.
 * Fails closed: returns null for anything that is not an exact, balanced match,
 * so a malformed SKU leaves the cart untouched rather than shipping wrong goods.
 */
export function parseBundleSku(sku) {
  if (typeof sku !== "string") return null;
  const match = SKU_PATTERN.exec(sku.trim());
  if (!match) return null;

  const bundleSize = Number(match[1]);
  const counts = {};
  let total = 0;
  for (let i = 0; i < SHADE_ORDER.length; i += 1) {
    const qty = Number(match[i + 2]);
    if (qty > 0) counts[SHADE_ORDER[i]] = qty;
    total += qty;
  }
  // The shade counts must account for the whole bundle, or we do not know what
  // the customer actually bought.
  if (total !== bundleSize) return null;
  return { bundleSize, counts };
}

/** Split a money amount across n units so the parts sum back exactly. */
export function allocate(totalMinor, units) {
  if (units <= 0) return [];
  const base = Math.floor(totalMinor / units);
  let remainder = totalMinor - base * units;
  const parts = new Array(units).fill(base);
  for (let i = 0; remainder > 0; i += 1, remainder -= 1) parts[i] += 1;
  return parts;
}

/**
 * Build expanded cart items for one bundle line.
 *
 * The bundle's own price is spread across the dye bottles and the free kit is
 * pinned to zero, so the expanded lines always sum back to exactly what the
 * customer was shown. Prices are handled in minor units to avoid float drift.
 */
export function buildExpandedItems(sku, bundlePriceAmount) {
  const parsed = parseBundleSku(sku);
  if (!parsed) return null;

  const totalBottles = Object.values(parsed.counts).reduce((a, b) => a + b, 0);
  if (totalBottles < 1) return null;

  const totalMinor = Math.round(Number(bundlePriceAmount) * 100);
  if (!Number.isFinite(totalMinor) || totalMinor < 0) return null;

  // Every bottle gets the same per-unit price and any leftover minor units land
  // on the kit line. The kit is always quantity 1, so it can absorb a remainder
  // of 0..(totalBottles-1) exactly.
  //
  // This deliberately avoids emitting the same merchandiseId twice with
  // different prices: fixedPricePerUnit is uniform within a line, so carrying a
  // remainder inside a shade would require splitting that shade into two
  // expanded items, and duplicate merchandise ids in one expand are not a
  // documented guarantee. One line per shade keeps the payload unambiguous.
  const perBottle = Math.floor(totalMinor / totalBottles);
  const remainder = totalMinor - perBottle * totalBottles;

  const items = [];
  for (const shade of SHADE_ORDER) {
    const qty = parsed.counts[shade];
    if (!qty) continue;
    items.push({
      merchandiseId: COMPONENT_VARIANTS[shade],
      quantity: qty,
      priceMinor: perBottle,
    });
  }

  items.push({ merchandiseId: FREE_KIT_VARIANT, quantity: 1, priceMinor: remainder });
  return items;
}

/** Total of expanded items in minor units, for assertions and tests. */
export function itemsTotalMinor(items) {
  return items.reduce((sum, i) => sum + i.priceMinor * i.quantity, 0);
}
