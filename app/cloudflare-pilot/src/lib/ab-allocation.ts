import { createHash } from "node:crypto";

export const BASIS_POINTS_TOTAL = 10_000;

export interface VariantAllocation {
  variantId: string;
  weightBasisPoints: number;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Stable bucket in [0, BASIS_POINTS_TOTAL) for one visitor and allocation version. */
export function bucketFor(visitorKey: string, experimentId: string, allocationVersion: number | string): number {
  return parseInt(sha256(`${visitorKey}:${experimentId}:${allocationVersion}`).slice(0, 12), 16) % BASIS_POINTS_TOTAL;
}

/**
 * Chooses a variant purely from the visitor token, so the same visitor always
 * lands on the same variant until the allocation version changes. Allocations
 * are sorted by variantId first: iteration order from the database is not
 * guaranteed, and an unstable order would silently reshuffle every visitor.
 */
export function pickVariant(
  visitorKey: string,
  experimentId: string,
  allocationVersion: number | string,
  allocations: VariantAllocation[],
): string | null {
  if (!allocations.length) return null;
  const bucket = bucketFor(visitorKey, experimentId, allocationVersion);
  const sorted = [...allocations].sort((a, b) => a.variantId.localeCompare(b.variantId));
  let cursor = 0;
  // Weights that sum below BASIS_POINTS_TOTAL leave a gap; the last variant
  // absorbs it rather than returning nothing and blanking the page.
  let selected = sorted[sorted.length - 1].variantId;
  for (const alloc of sorted) {
    cursor += alloc.weightBasisPoints;
    if (bucket < cursor) {
      selected = alloc.variantId;
      break;
    }
  }
  return selected;
}
