import { Router } from "express";
import prisma from "../lib/db.js";

const router = Router();
const DEFAULT_SHOP_DOMAIN = process.env.SHOP_DOMAIN || "local-dev.myshopify.com";

// Helper to ensure shop exists
async function getOrCreateShop() {
  let shop = await prisma.shop.findUnique({ where: { domain: DEFAULT_SHOP_DOMAIN } });
  if (!shop) {
    shop = await prisma.shop.create({ data: { domain: DEFAULT_SHOP_DOMAIN } });
  }
  return shop;
}

// GET /api/funnels — List all active/draft funnels
router.get("/funnels", async (_req, res) => {
  try {
    const shop = await getOrCreateShop();
    const funnels = await prisma.funnel.findMany({
      where: { shopId: shop.id },
      include: {
        _count: { select: { steps: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
    res.json(funnels);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to fetch funnels" });
  }
});

// POST /api/funnels — Create a new funnel with default steps
router.post("/funnels", async (req, res) => {
  try {
    const { name, slug } = req.body;
    if (!name || !slug) {
      return res.status(400).json({ error: "Name and slug are required" });
    }

    const shop = await getOrCreateShop();

    // Check slug collision
    const existing = await prisma.funnel.findFirst({
      where: { shopId: shop.id, slug },
    });
    if (existing) {
      return res.status(400).json({ error: "A funnel with this URL slug already exists" });
    }

    // Create funnel with 4 default steps
    const funnel = await prisma.funnel.create({
      data: {
        shopId: shop.id,
        name: name.trim(),
        slug: slug.trim().toLowerCase(),
        status: "DRAFT",
        steps: {
          create: [
            { position: 1, name: "Landing Page", kind: "LANDING" },
            { position: 2, name: "Checkout", kind: "CHECKOUT" },
            { position: 3, name: "Upsell", kind: "UPSELL" },
            { position: 4, name: "Thank You", kind: "THANK_YOU" },
          ],
        },
      },
      include: {
        steps: true,
      },
    });

    // Create default "Main" variant for non-checkout steps
    for (const step of funnel.steps) {
      if (step.kind !== "CHECKOUT") {
        await prisma.variant.create({
          data: {
            stepId: step.id,
            name: "Main",
          },
        });
      }
    }

    res.status(201).json(funnel);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to create funnel" });
  }
});

// GET /api/funnels/:id — Get full funnel details with steps, variants, experiments
router.get("/funnels/:id", async (req, res) => {
  try {
    const funnel = await prisma.funnel.findUnique({
      where: { id: req.params.id },
      include: {
        steps: {
          orderBy: { position: "asc" },
          include: {
            variants: {
              include: {
                versions: {
                  orderBy: { revision: "desc" },
                  take: 1,
                },
              },
            },
            experiment: {
              include: {
                allocations: true,
              },
            },
          },
        },
      },
    });

    if (!funnel) {
      return res.status(404).json({ error: "Funnel not found" });
    }

    res.json(funnel);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to fetch funnel" });
  }
});

// PATCH /api/funnels/:id — Update funnel properties
router.patch("/funnels/:id", async (req, res) => {
  try {
    const { name, status } = req.body;
    const data: any = {};
    if (name) data.name = name.trim();
    if (status) {
      data.status = status;
      if (status === "ARCHIVED") data.archivedAt = new Date();
    }

    const updated = await prisma.funnel.update({
      where: { id: req.params.id },
      data,
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to update funnel" });
  }
});

// DELETE /api/funnels/:id — Soft delete / Archive funnel
router.delete("/funnels/:id", async (req, res) => {
  try {
    await prisma.funnel.update({
      where: { id: req.params.id },
      data: { status: "ARCHIVED", archivedAt: new Date() },
    });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to archive funnel" });
  }
});

export default router;
