import { Router } from "express";
import prisma from "../lib/db.js";
import { analyzeHtml } from "../lib/portability.js";
import { BASIS_POINTS_TOTAL } from "../services/ab-engine.js";

const router = Router();

// POST /api/steps/:stepId/variants — Create new variant
router.post("/steps/:stepId/variants", async (req, res) => {
  try {
    const { stepId } = req.params;
    const { name, duplicateFrom } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Variant name is required" });
    }

    const step = await prisma.step.findUnique({ where: { id: stepId } });
    if (!step) {
      return res.status(404).json({ error: "Step not found" });
    }

    if (step.kind === "CHECKOUT") {
      return res.status(400).json({ error: "Checkout step cannot have variants" });
    }

    const variant = await prisma.variant.create({
      data: {
        stepId,
        name: name.trim(),
      },
    });

    // If duplicating from an existing variant, copy its latest draft/published content
    if (duplicateFrom) {
      const sourceVersion = await prisma.contentVersion.findFirst({
        where: { variantId: duplicateFrom },
        orderBy: { revision: "desc" },
      });
      if (sourceVersion) {
        const { normalizedHtml, report } = analyzeHtml(sourceVersion.rawHtml);
        await prisma.contentVersion.create({
          data: {
            variantId: variant.id,
            revision: 1,
            state: "DRAFT",
            rawHtml: sourceVersion.rawHtml,
            normalizedHtml,
            portReport: JSON.stringify(report),
          },
        });
      }
    }

    const result = await prisma.variant.findUnique({
      where: { id: variant.id },
      include: { versions: { orderBy: { revision: "desc" }, take: 1 } },
    });

    res.status(201).json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to create variant" });
  }
});

// GET /api/variants/:id — Get variant with step info and versions
router.get("/variants/:id", async (req, res) => {
  try {
    const variant = await prisma.variant.findUnique({
      where: { id: req.params.id },
      include: {
        step: {
          include: {
            funnel: true,
          },
        },
        versions: {
          orderBy: { revision: "desc" },
        },
      },
    });

    if (!variant) {
      return res.status(404).json({ error: "Variant not found" });
    }

    res.json(variant);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to fetch variant" });
  }
});

// PUT /api/variants/:id/content — Save variant HTML content (creates DRAFT version)
router.put("/variants/:id/content", async (req, res) => {
  try {
    const { html } = req.body;
    if (typeof html !== "string") {
      return res.status(400).json({ error: "HTML string content is required" });
    }

    const variant = await prisma.variant.findUnique({ where: { id: req.params.id } });
    if (!variant) {
      return res.status(404).json({ error: "Variant not found" });
    }

    const latestVersion = await prisma.contentVersion.findFirst({
      where: { variantId: variant.id },
      orderBy: { revision: "desc" },
    });

    const revision = (latestVersion?.revision || 0) + 1;
    const { normalizedHtml, report } = analyzeHtml(html);

    const version = await prisma.contentVersion.create({
      data: {
        variantId: variant.id,
        revision,
        state: "DRAFT",
        rawHtml: html,
        normalizedHtml,
        portReport: JSON.stringify(report),
      },
    });

    res.json({ version, portReport: report });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to save content" });
  }
});

// POST /api/variants/:id/publish — Publish variant draft content
router.post("/variants/:id/publish", async (req, res) => {
  try {
    const variantId = req.params.id;
    const latestVersion = await prisma.contentVersion.findFirst({
      where: { variantId },
      orderBy: { revision: "desc" },
    });

    if (!latestVersion) {
      return res.status(400).json({ error: "No content draft to publish. Save HTML first." });
    }

    // Unpublish previous versions
    await prisma.contentVersion.updateMany({
      where: { variantId, state: "PUBLISHED" },
      data: { state: "ARCHIVED" },
    });

    const published = await prisma.contentVersion.update({
      where: { id: latestVersion.id },
      data: { state: "PUBLISHED", publishedAt: new Date() },
    });

    await prisma.variant.update({
      where: { id: variantId },
      data: { publishedVersionId: published.id },
    });

    res.json(published);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to publish variant" });
  }
});

// DELETE /api/variants/:id — Delete variant
router.delete("/variants/:id", async (req, res) => {
  try {
    await prisma.variant.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to delete variant" });
  }
});

/* ==================== A/B EXPERIMENT ROUTES ==================== */

// POST /api/steps/:stepId/experiments — Create A/B experiment
router.post("/steps/:stepId/experiments", async (req, res) => {
  try {
    const { stepId } = req.params;
    const { allocations } = req.body; // Array of { variantId, weightBasisPoints }

    const step = await prisma.step.findUnique({ where: { id: stepId }, include: { variants: true } });
    if (!step) return res.status(404).json({ error: "Step not found" });

    if (step.variants.length < 2) {
      return res.status(400).json({ error: "Step must have at least 2 variants to start an A/B test" });
    }

    const defaultAllocations = allocations || step.variants.map((v, i) => ({
      variantId: v.id,
      weightBasisPoints: Math.floor(BASIS_POINTS_TOTAL / step.variants.length) + (i === 0 ? BASIS_POINTS_TOTAL % step.variants.length : 0),
    }));

    const totalWeight = defaultAllocations.reduce((sum: number, a: any) => sum + Number(a.weightBasisPoints), 0);
    if (totalWeight !== BASIS_POINTS_TOTAL) {
      return res.status(400).json({ error: `Allocations must total ${BASIS_POINTS_TOTAL} basis points (100%)` });
    }

    const experiment = await prisma.experiment.create({
      data: {
        stepId,
        status: "RUNNING",
        allocationVersion: 1,
        allocations: {
          create: defaultAllocations.map((a: any) => ({
            variantId: a.variantId,
            weightBasisPoints: Number(a.weightBasisPoints),
          })),
        },
      },
      include: { allocations: true },
    });

    res.status(201).json(experiment);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to create experiment" });
  }
});

// PATCH /api/experiments/:id/allocations — Update A/B traffic weights
router.patch("/experiments/:id/allocations", async (req, res) => {
  try {
    const { allocations } = req.body; // [{ variantId, weightBasisPoints }]
    if (!Array.isArray(allocations)) {
      return res.status(400).json({ error: "Allocations array is required" });
    }

    const totalWeight = allocations.reduce((sum, a) => sum + Number(a.weightBasisPoints), 0);
    if (totalWeight !== BASIS_POINTS_TOTAL) {
      return res.status(400).json({ error: `Allocations must total ${BASIS_POINTS_TOTAL} basis points (100%)` });
    }

    const experiment = await prisma.experiment.findUnique({ where: { id: req.params.id } });
    if (!experiment) return res.status(404).json({ error: "Experiment not found" });

    await prisma.experimentAllocation.deleteMany({ where: { experimentId: experiment.id } });

    for (const alloc of allocations) {
      await prisma.experimentAllocation.create({
        data: {
          experimentId: experiment.id,
          variantId: alloc.variantId,
          weightBasisPoints: Number(alloc.weightBasisPoints),
        },
      });
    }

    const updated = await prisma.experiment.update({
      where: { id: experiment.id },
      data: { allocationVersion: experiment.allocationVersion + 1 },
      include: { allocations: true },
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to update allocations" });
  }
});

// POST /api/experiments/:id/promote/:variantId — Promote winning variant to 100%
router.post("/experiments/:id/promote/:variantId", async (req, res) => {
  try {
    const { id, variantId } = req.params;

    const experiment = await prisma.experiment.findUnique({ where: { id } });
    if (!experiment) return res.status(404).json({ error: "Experiment not found" });

    // Set promoted variant weight to 100%, stop experiment
    await prisma.experimentAllocation.deleteMany({ where: { experimentId: id } });
    await prisma.experimentAllocation.create({
      data: {
        experimentId: id,
        variantId,
        weightBasisPoints: BASIS_POINTS_TOTAL,
      },
    });

    const updated = await prisma.experiment.update({
      where: { id },
      data: { status: "COMPLETED", allocationVersion: experiment.allocationVersion + 1 },
      include: { allocations: true },
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to promote variant" });
  }
});

// DELETE /api/experiments/:id/kill/:variantId — Kill variant and redistribute weight
router.delete("/experiments/:id/kill/:variantId", async (req, res) => {
  try {
    const { id, variantId } = req.params;

    await prisma.experimentAllocation.deleteMany({
      where: { experimentId: id, variantId },
    });

    const remaining = await prisma.experimentAllocation.findMany({ where: { experimentId: id } });
    if (remaining.length > 0) {
      const equalWeight = Math.floor(BASIS_POINTS_TOTAL / remaining.length);
      const remainder = BASIS_POINTS_TOTAL % remaining.length;
      for (let i = 0; i < remaining.length; i++) {
        await prisma.experimentAllocation.update({
          where: { id: remaining[i].id },
          data: { weightBasisPoints: equalWeight + (i === 0 ? remainder : 0) },
        });
      }
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to kill variant" });
  }
});

export default router;
