import { createHash } from "node:crypto";

export const ELEMENT_BASIS_POINTS_TOTAL = 10_000;

export function hashAnonymousKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface WeightedVariant {
  variantId: string;
  weightBasisPoints: number;
}

export function elementBucket(anonymousKey: string, experimentId: string, allocationVersion: number): number {
  const hash = hashAnonymousKey(`${anonymousKey}:${experimentId}:${allocationVersion}`);
  return Number.parseInt(hash.slice(0, 12), 16) % ELEMENT_BASIS_POINTS_TOTAL;
}

export function chooseElementVariant(allocations: WeightedVariant[], bucket: number): string | null {
  if (allocations.length === 0 || bucket < 0 || bucket >= ELEMENT_BASIS_POINTS_TOTAL) return null;
  const sorted = [...allocations].sort((left, right) => left.variantId.localeCompare(right.variantId));
  let cursor = 0;
  for (const allocation of sorted) {
    cursor += allocation.weightBasisPoints;
    if (bucket < cursor) return allocation.variantId;
  }
  return sorted[sorted.length - 1].variantId;
}

export interface ElementSelection {
  assignmentId: string;
  experimentId: string;
  experimentKey: string;
  allocationVersion: number;
  posthogFlagKey: string | null;
  variantId: string;
}

export interface ExistingElementAssignment {
  variantId: string;
  allocationVersion: number;
}

export function canReuseElementAssignment(
  assignment: ExistingElementAssignment,
  allocationVersion: number,
  allocations: WeightedVariant[],
): boolean {
  return assignment.allocationVersion === allocationVersion
    && allocations.some(allocation => allocation.variantId === assignment.variantId && allocation.weightBasisPoints > 0);
}

export async function selectElementVariant(slotId: string, shopId: string, anonymousKey: string): Promise<ElementSelection | null> {
  const { default: prisma } = await import("../lib/db.js");
  const experiment = await prisma.elementExperiment.findUnique({
    where: { slotId },
    include: { allocations: true },
  });
  if (!experiment || !["RUNNING", "COMPLETED"].includes(experiment.status) || experiment.allocations.length === 0) return null;

  const visitor = await prisma.visitor.upsert({
    where: {
      shopId_anonymousKeyHash: {
        shopId,
        anonymousKeyHash: hashAnonymousKey(anonymousKey),
      },
    },
    update: {},
    create: { shopId, anonymousKeyHash: hashAnonymousKey(anonymousKey) },
  });

  const existing = await prisma.elementAssignment.findUnique({
    where: {
      visitorId_experimentId: {
        visitorId: visitor.id,
        experimentId: experiment.id,
      },
    },
  });
  if (existing && canReuseElementAssignment(existing, experiment.allocationVersion, experiment.allocations)) {
    return {
      assignmentId: existing.id,
      experimentId: experiment.id,
      experimentKey: experiment.key,
      allocationVersion: experiment.allocationVersion,
      posthogFlagKey: experiment.posthogFlagKey,
      variantId: existing.variantId,
    };
  }

  const bucket = elementBucket(anonymousKey, experiment.id, experiment.allocationVersion);
  const selectedVariantId = chooseElementVariant(experiment.allocations, bucket);
  if (!selectedVariantId) return null;

  const assignment = await prisma.elementAssignment.upsert({
    where: { visitorId_experimentId: { visitorId: visitor.id, experimentId: experiment.id } },
    update: {
      variantId: selectedVariantId,
      allocationVersion: experiment.allocationVersion,
      assignedAt: new Date(),
    },
    create: {
      visitorId: visitor.id,
      experimentId: experiment.id,
      variantId: selectedVariantId,
      allocationVersion: experiment.allocationVersion,
    },
  });

  return {
    assignmentId: assignment.id,
    experimentId: experiment.id,
    experimentKey: experiment.key,
    allocationVersion: experiment.allocationVersion,
    posthogFlagKey: experiment.posthogFlagKey,
    variantId: assignment.variantId,
  };
}
