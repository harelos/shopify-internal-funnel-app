import { createHash } from "node:crypto";

export const ELEMENT_BASIS_POINTS_TOTAL = 10_000;

export function hashAnonymousKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface WeightedVariant {
  variantId: string;
  weightBasisPoints: number;
}

export interface ElementAllocationQaRow {
  variantId: string;
  configuredPercent: number;
  observedVisitors: number;
  observedPercent: number;
  deviationPercentagePoints: number;
}

export interface ElementAllocationQaSample {
  visitorId: string;
  bucket: number;
  variantId: string;
}

export interface ElementAllocationQaReport {
  experimentId: string;
  allocationVersion: number;
  sampleSize: number;
  seedPrefix: string;
  rows: ElementAllocationQaRow[];
  sampleAssignments: ElementAllocationQaSample[];
  deterministicReplayPassed: boolean;
  totalAssigned: number;
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

export function simulateElementAllocation(
  allocations: WeightedVariant[],
  experimentId: string,
  allocationVersion: number,
  sampleSize = 20_000,
  seedPrefix = "gallery-allocation-qa",
): ElementAllocationQaReport {
  if (!Number.isInteger(sampleSize) || sampleSize < 100 || sampleSize > 100_000) {
    throw new Error("Allocation QA sample size must be an integer from 100 to 100000.");
  }
  if (allocations.reduce((sum, allocation) => sum + allocation.weightBasisPoints, 0) !== ELEMENT_BASIS_POINTS_TOTAL) {
    throw new Error(`Allocation QA requires weights totaling ${ELEMENT_BASIS_POINTS_TOTAL} basis points.`);
  }

  const counts = new Map(allocations.map(allocation => [allocation.variantId, 0]));
  const sampleAssignments: ElementAllocationQaSample[] = [];
  let deterministicReplayPassed = true;

  for (let index = 0; index < sampleSize; index += 1) {
    const visitorId = `${seedPrefix}-${String(index + 1).padStart(6, "0")}`;
    const bucket = elementBucket(visitorId, experimentId, allocationVersion);
    const variantId = chooseElementVariant(allocations, bucket);
    if (!variantId) continue;
    counts.set(variantId, (counts.get(variantId) ?? 0) + 1);
    deterministicReplayPassed = deterministicReplayPassed
      && elementBucket(visitorId, experimentId, allocationVersion) === bucket
      && chooseElementVariant(allocations, bucket) === variantId;
    if (sampleAssignments.length < 20) sampleAssignments.push({ visitorId, bucket, variantId });
  }

  const totalAssigned = Array.from(counts.values()).reduce((sum, count) => sum + count, 0);
  return {
    experimentId,
    allocationVersion,
    sampleSize,
    seedPrefix,
    deterministicReplayPassed,
    totalAssigned,
    rows: allocations
      .map(allocation => {
        const observedVisitors = counts.get(allocation.variantId) ?? 0;
        const observedPercent = totalAssigned ? (observedVisitors / totalAssigned) * 100 : 0;
        const configuredPercent = allocation.weightBasisPoints / 100;
        return {
          variantId: allocation.variantId,
          configuredPercent,
          observedVisitors,
          observedPercent: Number(observedPercent.toFixed(3)),
          deviationPercentagePoints: Number((observedPercent - configuredPercent).toFixed(3)),
        };
      })
      .sort((left, right) => left.variantId.localeCompare(right.variantId)),
    sampleAssignments,
  };
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
