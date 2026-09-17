import { decodeBundleSku, type ExpectedBundle, type NovaHairCjProductLine } from "./novahair-cj-auto-order.js";

/**
 * OceAura Amla bundles, sold from /pages/oceaura-sales-staging.
 *
 * A NOVASALE SKU lists bottles per colour; an OCEASALE SKU lists the three
 * products in a fixed order: shampoo, conditioner, oil. The bundle becomes
 * plain component lines for CJ, one per product, because CJ's own "Set"
 * variants on the conditioner listing pair OceAura with a different brand's
 * anti-dandruff shampoo and cannot be used.
 */
export type OceAuraComponentKey = "shampoo" | "conditioner" | "oil";

export const OCEAURA_CJ_MAPPINGS: Record<OceAuraComponentKey, { vid: string; sku: string; name: string; weight_g: number }> = {
  shampoo: { vid: "1784426913461710848", sku: "CJST202283801AZ", name: "Amla Anti Hair Thinning Shampoo", weight_g: 148 },
  conditioner: { vid: "1784424014744662016", sku: "CJST202282501AZ", name: "Amla Anti Hair Thinning Conditioner", weight_g: 148 },
  oil: { vid: "1784422716368498688", sku: "CJST202282001AZ", name: "Amla Hair Oil", weight_g: 90 },
};

const OCEAURA_ORDER: OceAuraComponentKey[] = ["shampoo", "conditioner", "oil"];
const REGEX_OCEASALE = /^OCEASALE-(\d+)-(\d+)-(\d+)$/;

/** True when this SKU is an OceAura bundle line. */
export function isOceAuraBundleSku(sku: string): boolean {
  return REGEX_OCEASALE.test(String(sku ?? "").trim());
}

/**
 * Reads OCEASALE-{shampoo}-{conditioner}-{oil} into CJ component lines.
 *
 * Returns the same ExpectedBundle shape the NovaHair queue already stores and
 * replays, with the colour counts at zero and the component lines spelled out,
 * so nothing downstream needs a second queue.
 */
export function decodeOceAuraBundleSku(sku: string, parentQuantity: number = 1): ExpectedBundle | null {
  const match = REGEX_OCEASALE.exec(String(sku ?? "").trim());
  if (!match) return null;
  const counts: Record<OceAuraComponentKey, number> = {
    shampoo: Number.parseInt(match[1], 10),
    conditioner: Number.parseInt(match[2], 10),
    oil: Number.parseInt(match[3], 10),
  };
  const multiplier = Math.max(1, Number(parentQuantity) || 1);
  const total = OCEAURA_ORDER.reduce((sum, key) => sum + counts[key], 0);
  if (!Number.isFinite(total) || total <= 0) return null;

  const lines: NovaHairCjProductLine[] = OCEAURA_ORDER
    .filter(key => counts[key] > 0)
    .map(key => ({ vid: OCEAURA_CJ_MAPPINGS[key].vid, sku: OCEAURA_CJ_MAPPINGS[key].sku, quantity: counts[key] * multiplier }));
  const weight = OCEAURA_ORDER.reduce((sum, key) => sum + counts[key] * OCEAURA_CJ_MAPPINGS[key].weight_g, 0) * multiplier;

  return {
    brand: "oceaura",
    bundle_size: total * multiplier,
    black: 0,
    dark_brown: 0,
    medium_brown: 0,
    light_brown: 0,
    purple: 0,
    red: 0,
    free_kit: 0,
    expected_weight_g: weight,
    original_sku: String(sku).trim(),
    lines,
  };
}

/** Either brand's bundle SKU, or null. */
export function decodeAnyBundleSku(sku: string, parentQuantity: number = 1): ExpectedBundle | null {
  return decodeBundleSku(sku, parentQuantity) ?? decodeOceAuraBundleSku(sku, parentQuantity);
}
