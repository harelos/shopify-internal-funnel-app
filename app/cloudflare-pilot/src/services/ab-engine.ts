import prisma from "../lib/db.js";
import { BASIS_POINTS_TOTAL, pickVariant } from "../lib/ab-allocation.js";
import { findOrCreateVisitor } from "../lib/visitor-store.js";

export { BASIS_POINTS_TOTAL };

/**
 * `visitorKey` is the pseudonymous storefront token (the `_fv` cookie), not a
 * Visitor primary key. It is persisted as Visitor.anonymousKeyHash, so it must
 * be looked up that way; querying it as Visitor.id never matched, which meant
 * no assignment was ever written and every exposure went unmeasured.
 */
export async function selectVariant(stepId: string, visitorKey: string): Promise<string | null> {
  const step = await prisma.step.findUnique({
    where: { id: stepId },
    include: { funnel: { select: { shopId: true } } },
  });
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

  if (!visitorKey) return null;

  // Exposure has to be recorded at assignment time. Waiting for a tracking
  // event to create the visitor first loses every single-page-view visitor.
  const visitor = await findOrCreateVisitor(step.funnel.shopId, visitorKey);

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

  const selectedVariantId = pickVariant(
    visitorKey,
    experiment.id,
    experiment.allocationVersion,
    experiment.allocations,
  );

  if (selectedVariantId) {
    try {
      await prisma.assignment.create({
        data: {
          visitorId: visitor.id,
          experimentId: experiment.id,
          variantId: selectedVariantId,
        },
      });
    } catch {
      // A concurrent request won the race. Bucketing is deterministic, so the
      // stored assignment matches what we computed here.
    }
  }

  return selectedVariantId;
}
