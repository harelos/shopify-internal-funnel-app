import { createHash } from "node:crypto";
import prisma from "../lib/db.js";

export const BASIS_POINTS_TOTAL = 10_000;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function selectVariant(stepId: string, visitorId: string): Promise<string | null> {
  const step = await prisma.step.findUnique({ where: { id: stepId } });
  if (!step) return null;

  if (step.kind === "CHECKOUT") return null;

  const experiment = await prisma.experiment.findUnique({
    where: { stepId },
    include: { allocations: true },
  });

  if (!experiment || experiment.status !== "RUNNING" || experiment.allocations.length === 0) {
    // Return first variant if no running experiment
    const variant = await prisma.variant.findFirst({
      where: { stepId },
      orderBy: { createdAt: "asc" },
    });
    return variant?.id ?? null;
  }

  // Check sticky assignment in DB first
  const visitor = await prisma.visitor.findFirst({ where: { id: visitorId } });
  if (visitor) {
    const existingAssignment = await prisma.assignment.findUnique({
      where: {
        visitorId_experimentId: {
          visitorId: visitor.id,
          experimentId: experiment.id,
        },
      },
    });
    if (existingAssignment) {
      return existingAssignment.variantId;
    }
  }

  // Deterministic bucket selection based on visitorId and allocationVersion
  const hashVal = sha256(`${visitorId}:${experiment.id}:${experiment.allocationVersion}`);
  const bucket = parseInt(hashVal.slice(0, 12), 16) % BASIS_POINTS_TOTAL;

  const sortedAllocations = experiment.allocations.sort((a, b) => a.variantId.localeCompare(b.variantId));
  let cursor = 0;
  let selectedVariantId = sortedAllocations[sortedAllocations.length - 1]?.variantId ?? null;

  for (const alloc of sortedAllocations) {
    cursor += alloc.weightBasisPoints;
    if (bucket < cursor) {
      selectedVariantId = alloc.variantId;
      break;
    }
  }

  // Record sticky assignment if visitor exists
  if (visitor && selectedVariantId) {
    try {
      await prisma.assignment.create({
        data: {
          visitorId: visitor.id,
          experimentId: experiment.id,
          variantId: selectedVariantId,
        },
      });
    } catch {
      // Ignore duplicate assignment errors
    }
  }

  return selectedVariantId;
}
