import { Router } from "express";
import prisma from "../lib/db.js";
import { getShopifyConfig } from "../lib/shopify-config.js";
import {
  DuplicateFunnelInputError,
  importDuplicateStepPages,
  normalizeDuplicateSteps,
  normalizeFunnelSlug,
  replaceImportedLink,
} from "../lib/funnel-duplicate.js";

const router = Router();
const DEFAULT_SHOP_DOMAIN = process.env.SHOP_DOMAIN || "local-dev.myshopify.com";

function publicFunnelUrls(slug: string, status: string) {
  if (status !== "PUBLISHED") return { publicUrl: null, publicRootUrl: null };
  const domain = String(process.env.SHOPIFY_STOREFRONT_DOMAIN || "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
  if (!domain) return { publicUrl: null, publicRootUrl: null };
  const proxyPath = String(process.env.SHOPIFY_APP_PROXY_PATH || "/apps/funnels")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  const publicRootUrl = `https://${domain}/${proxyPath}/${slug}`;
  return { publicUrl: `${publicRootUrl}/1`, publicRootUrl };
}

// Helper to ensure shop exists
async function getOrCreateShop() {
  let shop = await prisma.shop.findUnique({ where: { domain: DEFAULT_SHOP_DOMAIN } });
  if (!shop) {
    shop = await prisma.shop.create({ data: { domain: DEFAULT_SHOP_DOMAIN } });
  }
  return shop;
}

// GET /api/funnels — List all active/draft funnels (excluding archived)
router.get("/funnels", async (_req, res) => {
  try {
    const shop = await getOrCreateShop();
    const funnels = await prisma.funnel.findMany({
      where: {
        shopId: shop.id,
        NOT: { status: "ARCHIVED" },
      },
      include: {
        _count: { select: { steps: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
    res.json(funnels.map(funnel => ({
      ...funnel,
      ...publicFunnelUrls(funnel.slug, funnel.status),
    })));
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
      where: { shopId: shop.id, slug, NOT: { status: "ARCHIVED" } },
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

// POST /api/funnels/duplicate — Create a separate draft funnel from public Shopify pages.
// The source pages remain unchanged; only sanitized snapshots are stored in the new draft.
router.post("/funnels/duplicate", async (req, res) => {
  try {
    const name = String(req.body?.name ?? "").trim();
    if (!name) return res.status(400).json({ error: "Funnel name is required" });
    const slug = normalizeFunnelSlug(req.body?.slug);
    const requestedSteps = normalizeDuplicateSteps(req.body?.steps);

    const shop = await getOrCreateShop();
    const existing = await prisma.funnel.findFirst({ where: { shopId: shop.id, slug, NOT: { status: "ARCHIVED" } } });
    if (existing) return res.status(400).json({ error: "A funnel with this URL slug already exists" });

    const config = getShopifyConfig();
    const importedSteps = await importDuplicateStepPages(requestedSteps, {
      shopDomain: config.shopDomain,
      storefrontDomain: process.env.SHOPIFY_STOREFRONT_DOMAIN,
      allowedHosts: String(process.env.SHOPIFY_PAGE_IMPORT_ALLOWED_HOSTS ?? "")
        .split(",").map(host => host.trim()).filter(Boolean),
    });
    const proxyPath = String(process.env.SHOPIFY_APP_PROXY_PATH || "/apps/funnels").replace(/\/+$/, "");

    const stepData = importedSteps.map(({ step, imported }, index) => {
      let normalizedHtml = imported?.normalizedHtml;
      if (normalizedHtml && importedSteps[index + 1]?.imported?.finalUrl) {
        // Keep the imported listicle inside this duplicate instead of sending visitors
        // back to the live sales page. The proxy runtime turns #next-step into a
        // tracked internal navigation.
        normalizedHtml = replaceImportedLink(normalizedHtml, importedSteps[index + 1].imported!.finalUrl, "#next-step");
      }

      const importedVariant = imported ? {
        create: {
          name: "Imported source",
          sourceType: "SHOPIFY_IMPORTED",
          sourceUrl: imported.finalUrl,
          sourceTitle: imported.title,
          sourceImportedAt: new Date(),
          versions: {
            create: {
              revision: 1,
              state: "DRAFT",
              rawHtml: imported.html,
              normalizedHtml: normalizedHtml!,
              portReport: JSON.stringify({
                ...imported.report,
                sourceType: "SHOPIFY_IMPORTED",
                sourceUrl: imported.finalUrl,
                sourceTitle: imported.title,
                duplicateFunnel: true,
                internalNextStep: importedSteps[index + 1]?.imported ? `${proxyPath}/${slug}/${index + 2}` : null,
              }),
            },
          },
        },
      } : undefined;

      return {
        position: index + 1,
        name: step.name,
        kind: step.kind,
        ...(importedVariant ? { variants: importedVariant } : {}),
      };
    });

    const funnel = await prisma.funnel.create({
      data: {
        shopId: shop.id,
        name,
        slug,
        status: "DRAFT",
        steps: { create: stepData },
      },
      include: { steps: { orderBy: { position: "asc" }, include: { variants: { include: { versions: true } } } } },
    });

    res.status(201).json({
      funnel,
      sourcePages: importedSteps.filter(item => item.imported).map(item => ({
        step: item.step.name,
        url: item.imported!.finalUrl,
        title: item.imported!.title,
      })),
      note: "Created as DRAFT. The original Shopify pages and live funnels were not changed.",
    });
  } catch (err: any) {
    if (err instanceof DuplicateFunnelInputError) return res.status(err.status).json({ error: err.message });
    res.status(err?.status || 500).json({ error: err?.message || "Failed to duplicate funnel" });
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

    res.json({
      ...funnel,
      ...publicFunnelUrls(funnel.slug, funnel.status),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to fetch funnel" });
  }
});

// PATCH /api/funnels/:funnelId/steps/reorder — Batch reorder steps via drag and drop
router.patch("/funnels/:funnelId/steps/reorder", async (req, res) => {
  try {
    const { funnelId } = req.params;
    const { stepIds } = req.body; // Array of step IDs in new order

    if (!Array.isArray(stepIds)) {
      return res.status(400).json({ error: "stepIds array is required" });
    }

    // Step positions in SQLite must temporarily avoid position unique collision
    for (let i = 0; i < stepIds.length; i++) {
      await prisma.step.update({
        where: { id: stepIds[i] },
        data: { position: 1000 + i },
      });
    }

    for (let i = 0; i < stepIds.length; i++) {
      await prisma.step.update({
        where: { id: stepIds[i] },
        data: { position: i + 1 },
      });
    }

    const updatedSteps = await prisma.step.findMany({
      where: { funnelId },
      orderBy: { position: "asc" },
    });

    res.json(updatedSteps);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to reorder steps" });
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
