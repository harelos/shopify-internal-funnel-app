import { Router } from "express";
import prisma from "../lib/db.js";

const router = Router();

// POST /api/funnels/:funnelId/steps — Add a new step to a funnel
router.post("/funnels/:funnelId/steps", async (req, res) => {
  try {
    const { funnelId } = req.params;
    const { name, kind } = req.body;

    if (!name || !kind) {
      return res.status(400).json({ error: "Step name and kind are required" });
    }

    const funnel = await prisma.funnel.findUnique({ where: { id: funnelId } });
    if (!funnel) {
      return res.status(404).json({ error: "Funnel not found" });
    }

    // Get highest position
    const maxStep = await prisma.step.findFirst({
      where: { funnelId },
      orderBy: { position: "desc" },
    });
    const position = (maxStep?.position || 0) + 1;

    const step = await prisma.step.create({
      data: {
        funnelId,
        position,
        name: name.trim(),
        kind,
      },
    });

    // Create default "Main" variant for non-checkout steps
    if (kind !== "CHECKOUT") {
      await prisma.variant.create({
        data: {
          stepId: step.id,
          name: "Main",
        },
      });
    }

    const fullStep = await prisma.step.findUnique({
      where: { id: step.id },
      include: { variants: true },
    });

    res.status(201).json(fullStep);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to add step" });
  }
});

// PATCH /api/steps/:id — Update step (name, position)
router.patch("/steps/:id", async (req, res) => {
  try {
    const { name, position } = req.body;
    const data: any = {};
    if (name) data.name = name.trim();
    if (position !== undefined) data.position = Number(position);

    const updated = await prisma.step.update({
      where: { id: req.params.id },
      data,
      include: { variants: true },
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to update step" });
  }
});

// DELETE /api/steps/:id — Delete step and cascade variants/events
router.delete("/steps/:id", async (req, res) => {
  try {
    await prisma.step.delete({
      where: { id: req.params.id },
    });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to delete step" });
  }
});

export default router;
