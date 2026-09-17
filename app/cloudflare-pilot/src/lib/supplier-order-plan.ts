import { decodeOceAuraBundleSku, isOceAuraBundleSku } from "./oceaura-cj-auto-order.js";
import {
  ALL_SHADE_KEYS,
  BOTTLE_KEYS,
  BOTTLE_WEIGHT_G,
  CJ_ADDON_MAPPINGS,
  CJ_PHYSICAL_MAPPINGS,
  FREE_KIT_WEIGHT_G,
  UNMAPPED_COMPONENTS,
  decodeBundleSku,
  decodeExtraBottlesSku,
  emptyShadeCounts,
  type ExpectedAddon,
  type ExpectedBundle,
  type NovaHairComponentKey,
} from "./novahair-cj-auto-order.js";

export interface SupplierOrderLine {
  sku?: unknown;
  quantity?: unknown;
  name?: unknown;
  id?: unknown;
}

export type SupplierOrderPlanFailure = "NO_SUPPLIER_LINES" | "UNDECODABLE_SKU" | "NO_SUPPLIER_MAPPING";

export type SupplierOrderPlan =
  | { ok: true; expected: ExpectedBundle }
  | { ok: false; code: SupplierOrderPlanFailure; reason: string; sku: string | null };

/** A SKU CJ issued; the store sells CJ-sourced add-ons under CJ's own SKU. */
export function looksLikeCjSku(sku: string): boolean {
  return /^CJ[A-Z]{2}\d{6,}/i.test(String(sku ?? "").trim());
}

const NOVASALE_PREFIX = /^NOVASALE-/i;
const NOVAEXTRA_PREFIX = /^NOVAEXTRA-/i;

function fail(code: SupplierOrderPlanFailure, sku: string | null, reason: string): SupplierOrderPlan {
  return { ok: false, code, sku, reason };
}

/** Two bundles on one order become one parcel. */
function mergeBundles(a: ExpectedBundle, b: ExpectedBundle): ExpectedBundle {
  const merged: ExpectedBundle = {
    ...a,
    bundle_size: a.bundle_size + b.bundle_size,
    free_kit: a.free_kit + b.free_kit,
    expected_weight_g: a.expected_weight_g + b.expected_weight_g,
    original_sku: `${a.original_sku}+${b.original_sku}`,
    brand: a.brand ?? b.brand,
  };
  for (const key of ALL_SHADE_KEYS) merged[key] = Number(a[key] || 0) + Number(b[key] || 0);
  const lines = [...(a.lines || []), ...(b.lines || [])];
  if (lines.length) merged.lines = lines;
  return merged;
}

/**
 * Reads a Shopify order's lines into the parcel CJ must ship.
 *
 * Every line the store sells that CJ fulfils has to land here: the bundle of
 * either brand, the extra-bottle upsell, the add-ons sold beside it, or the
 * bundle arriving as its component SKUs. A line that looks like ours but
 * cannot be read, or that names a product CJ has no variant for, fails the
 * whole order loudly instead of shipping a smaller parcel: #4486 paid for six
 * bottles and the automatic order carried four, #4481 paid for a shade CJ
 * does not stock and was never ordered at all. Lines from other suppliers
 * (Shopify Collective) are simply not CJ's to ship.
 */
export function planSupplierOrder(lineItems: SupplierOrderLine[]): SupplierOrderPlan {
  let bundle: ExpectedBundle | null = null;
  const extraCounts = emptyShadeCounts();
  const extras: Array<{ sku: string; quantity: number }> = [];
  const addons = new Map<string, ExpectedAddon>();
  const components: Partial<Record<NovaHairComponentKey, number>> = {};

  for (const line of Array.isArray(lineItems) ? lineItems : []) {
    const sku = String(line?.sku ?? "").replace(/\s+/g, " ").trim();
    const quantity = Math.floor(Number(line?.quantity) || 0);
    if (!sku || quantity <= 0) continue;

    if (NOVASALE_PREFIX.test(sku)) {
      const decoded = decodeBundleSku(sku, quantity);
      if (!decoded) return fail("UNDECODABLE_SKU", sku, `Bundle SKU ${sku} is not a shape this code can read; no parcel can be built from it.`);
      bundle = bundle ? mergeBundles(bundle, decoded) : decoded;
      continue;
    }
    if (isOceAuraBundleSku(sku)) {
      const decoded = decodeOceAuraBundleSku(sku, quantity);
      if (!decoded) return fail("UNDECODABLE_SKU", sku, `Bundle SKU ${sku} is not a shape this code can read; no parcel can be built from it.`);
      bundle = bundle ? mergeBundles(bundle, decoded) : decoded;
      continue;
    }
    if (NOVAEXTRA_PREFIX.test(sku)) {
      const counts = decodeExtraBottlesSku(sku, quantity);
      if (!counts) return fail("UNDECODABLE_SKU", sku, `Extra-bottle SKU ${sku} is not a shape this code can read; no parcel can be built from it.`);
      for (const key of ALL_SHADE_KEYS) extraCounts[key] += counts[key];
      extras.push({ sku, quantity });
      continue;
    }
    const addon = CJ_ADDON_MAPPINGS[sku.toUpperCase()];
    if (addon) {
      const current = addons.get(addon.sku);
      addons.set(addon.sku, { sku: addon.sku, vid: addon.vid, name: addon.name, quantity: (current?.quantity || 0) + quantity });
      continue;
    }
    const component = (Object.keys(CJ_PHYSICAL_MAPPINGS) as NovaHairComponentKey[])
      .find(key => CJ_PHYSICAL_MAPPINGS[key].sku.toUpperCase() === sku.toUpperCase());
    if (component) {
      components[component] = (components[component] || 0) + quantity;
      continue;
    }
    if (looksLikeCjSku(sku)) {
      return fail("NO_SUPPLIER_MAPPING", sku, `${sku} is a CJ product with no entry in CJ_ADDON_MAPPINGS; the parcel cannot be built without it.`);
    }
    // Anything else is another supplier's to ship.
  }

  const extraTotal = ALL_SHADE_KEYS.reduce((sum, key) => sum + extraCounts[key], 0);
  let expected: ExpectedBundle | null = bundle;

  if (!expected && Number(components.free_kit || 0) > 0) {
    // The bundle arrived as its component SKUs, one line per product.
    const bottleSum = BOTTLE_KEYS.reduce((sum, key) => sum + Number(components[key] || 0), 0);
    const kits = Number(components.free_kit || 0);
    expected = {
      bundle_size: bottleSum,
      ...emptyShadeCounts(),
      ...Object.fromEntries(BOTTLE_KEYS.map(key => [key, Number(components[key] || 0)])),
      free_kit: kits,
      expected_weight_g: (bottleSum * BOTTLE_WEIGHT_G) + (kits * FREE_KIT_WEIGHT_G),
      original_sku: `DECOMPOSED-BUNDLE-${bottleSum}B`,
    };
  }

  if (!expected && extraTotal > 0) {
    // Extra bottles bought on their own, after the bundle: their own parcel, no kit.
    expected = {
      bundle_size: 0,
      ...emptyShadeCounts(),
      free_kit: 0,
      expected_weight_g: 0,
      original_sku: extras[0].sku,
    };
  }

  if (!expected) return fail("NO_SUPPLIER_LINES", null, "No line on this order is fulfilled by CJ.");

  if (extraTotal > 0) {
    for (const key of ALL_SHADE_KEYS) expected[key] = Number(expected[key] || 0) + extraCounts[key];
    expected.bundle_size += extraTotal;
    expected.expected_weight_g += extraTotal * BOTTLE_WEIGHT_G;
    expected.extras = extras;
  }

  if (addons.size) {
    expected.addons = [...addons.values()];
    expected.expected_weight_g += expected.addons.reduce((sum, addon) => sum + addon.quantity * (CJ_ADDON_MAPPINGS[addon.sku]?.weight_g || 0), 0);
  }

  const blonde = Number(expected.golden_blonde || 0);
  if (blonde > 0) {
    return fail("NO_SUPPLIER_MAPPING", expected.original_sku,
      `${blonde} × ${UNMAPPED_COMPONENTS.golden_blonde.name} cannot be ordered: ${UNMAPPED_COMPONENTS.golden_blonde.reason}`);
  }

  return { ok: true, expected };
}
