/**
 * First-party bucketing for the adaptive CRO test.
 *
 * PostHog on this store starts opted out and only wakes up once the shopper
 * accepts cookies, so it never assigned a variant to most visitors: on the
 * first night two paid orders carried no variant at all and the results table
 * stayed empty. The page now buckets the visitor itself from a key it already
 * has, and PostHog is told afterwards rather than being asked first.
 *
 * The same hash lives here and in the storefront engine, so a visitor lands in
 * the same bucket wherever it is computed. Keep the two in step.
 */

export interface CroVariantWeight { key: string; weight: number }

export const DEFAULT_CRO_WEIGHTS: CroVariantWeight[] = [
  { key: "control", weight: 50 },
  { key: "full_adaptive", weight: 50 },
];

/** FNV-1a, the same function the storefront engine runs. */
export function hashVisitorKey(visitorKey: string): number {
  let hash = 2166136261;
  for (let index = 0; index < visitorKey.length; index += 1) {
    hash ^= visitorKey.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Picks a variant from the visitor key. Deterministic, so the same shopper
 * keeps the same page across visits without anything being stored.
 */
export function bucketVisitor(visitorKey: string, weights: CroVariantWeight[]): string | null {
  const eligible = weights.filter(row => Number(row.weight) > 0);
  if (!eligible.length || !visitorKey) return null;
  const total = eligible.reduce((sum, row) => sum + Number(row.weight), 0);
  let bucket = hashVisitorKey(visitorKey) % total;
  for (const row of eligible) {
    bucket -= Number(row.weight);
    if (bucket < 0) return row.key;
  }
  return eligible[eligible.length - 1].key;
}

/** Shapes whatever PostHog returns into the list the storefront can bucket with. */
export function weightsFromFlag(flag: unknown): CroVariantWeight[] {
  const variants = (flag as any)?.filters?.multivariate?.variants;
  if (!Array.isArray(variants) || !variants.length) return DEFAULT_CRO_WEIGHTS;
  const rows = variants
    .map((variant: any) => ({ key: String(variant?.key ?? "").trim(), weight: Number(variant?.rollout_percentage) }))
    .filter(row => row.key && Number.isFinite(row.weight) && row.weight >= 0);
  if (!rows.length || !rows.some(row => row.weight > 0)) return DEFAULT_CRO_WEIGHTS;
  return rows;
}

export interface AssignmentCounters { addedToCart: boolean; reachedCheckout: boolean }

/** Which counters a batch of beacon events should raise on the visitor's row. */
export function countersFromEvents(events: Array<{ kind?: unknown }>): AssignmentCounters {
  let addedToCart = false;
  let reachedCheckout = false;
  for (const event of events || []) {
    const kind = String((event as any)?.kind ?? "");
    if (kind === "cart_add") addedToCart = true;
    if (kind === "checkout_click") reachedCheckout = true;
  }
  return { addedToCart, reachedCheckout };
}

export const CRO_EXPERIMENT_KEY = "nova_adaptive_cro_v2";
