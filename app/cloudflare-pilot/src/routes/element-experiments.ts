import { Router } from "express";
import { randomUUID } from "node:crypto";
import prisma from "../lib/db.js";
import { getShopifyConfig, workerEnvValue } from "../lib/shopify-config.js";
import { normalizeShopifyCartToken } from "../lib/shopify-cart-token.js";
import { verifyShopifyAppProxyRequest } from "../middleware/shopify-auth.js";
import {
  GALLERY_TEMPLATE_KEY,
  GALLERY_TEMPLATE_SCHEMA,
  normalizeElementPayload,
  parseStoredPayload,
} from "../lib/element-templates.js";
import {
  ELEMENT_BASIS_POINTS_TOTAL,
  hashAnonymousKey,
  selectElementVariant,
  simulateElementAllocation,
} from "../services/element-ab-engine.js";
import { buildElementExperimentResults } from "../services/element-results.js";
import { captureElementExposureToPostHog } from "../services/element-posthog.js";
import {
  normalizeElementAssignmentContexts,
  resolveBrowserVisitor,
  snapshotCartElementAssignments,
} from "../services/element-attribution.js";

export const elementAdminRouter = Router();
export const elementRuntimeRouter = Router();

const LOCAL_SHOP_DOMAIN = "local-dev.myshopify.com";

function configuredShopDomain(): string {
  return getShopifyConfig().shopDomain || LOCAL_SHOP_DOMAIN;
}

async function getOrCreateShop() {
  const domain = configuredShopDomain();
  return prisma.shop.upsert({ where: { domain }, update: {}, create: { domain } });
}

function pagePath(value: unknown): string {
  const path = String(value ?? "").trim();
  if (!path.startsWith("/") || path.includes("?") || path.includes("#") || path.length > 240) {
    throw new Error("Page path must start with / and must not include a query string or fragment.");
  }
  return path.replace(/\/+$/, "") || "/";
}

function slotKey(value: unknown): string {
  const key = String(value ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(key)) {
    throw new Error("Slot key must be 3-80 lowercase letters, numbers, dots, underscores, or hyphens.");
  }
  return key;
}

function targetSelector(value: unknown, fallbackKey: string): string {
  const selector = String(value ?? "").trim() || `[data-funnel-slot="${fallbackKey}"]`;
  if (selector.length > 240 || /[{};]/.test(selector)) {
    throw new Error("Target selector must be a single CSS selector under 240 characters.");
  }
  return selector;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function publicSlot(slot: any) {
  return {
    ...slot,
    template: slot.template ? { ...slot.template, schema: parseJson(slot.template.schemaJson), schemaJson: undefined } : undefined,
    variants: Array.isArray(slot.variants)
      ? slot.variants.map((variant: any) => ({
          ...variant,
          versions: Array.isArray(variant.versions)
            ? variant.versions.map((version: any) => ({ ...version, payload: parseJson(version.payloadJson), payloadJson: undefined }))
            : [],
        }))
      : [],
  };
}

const slotInclude = {
  template: true,
  variants: { include: { versions: { orderBy: { revision: "desc" as const } } } },
  experiment: { include: { allocations: true } },
};

async function buildElementPreflight(experimentId: string) {
  const experiment = await prisma.elementExperiment.findUnique({
    where: { id: experimentId },
    include: {
      allocations: true,
      slot: {
        include: {
          template: true,
          variants: { include: { versions: true } },
        },
      },
    },
  });
  if (!experiment) return null;

  const checks: Array<{ key: string; label: string; pass: boolean; detail: string }> = [];
  const add = (key: string, label: string, pass: boolean, detail: string) => checks.push({ key, label, pass, detail });
  const positiveAllocations = experiment.allocations.filter(allocation => allocation.weightBasisPoints > 0);
  const totalWeight = experiment.allocations.reduce((sum, allocation) => sum + allocation.weightBasisPoints, 0);
  add("startable_status", "Experiment can start", ["DRAFT", "PAUSED"].includes(experiment.status), `Status: ${experiment.status}`);
  add("traffic_total", "Traffic allocation totals 100%", totalWeight === ELEMENT_BASIS_POINTS_TOTAL, `${totalWeight / 100}% configured`);
  add("multiple_variants", "At least two live variants", positiveAllocations.length >= 2, `${positiveAllocations.length} variants receive traffic`);
  add("page_path", "Page target is valid", experiment.slot.pagePath.startsWith("/"), experiment.slot.pagePath);
  add("target_selector", "Element selector is configured", Boolean(experiment.slot.targetSelector.trim()), experiment.slot.targetSelector || "Missing selector");

  const variantById = new Map(experiment.slot.variants.map(variant => [variant.id, variant]));
  for (const allocation of positiveAllocations) {
    const variant = variantById.get(allocation.variantId);
    const published = variant?.versions.find(version => version.id === variant.publishedVersionId);
    add(
      `published_${allocation.variantId}`,
      `${variant?.name ?? allocation.variantId} is published`,
      Boolean(variant?.publishedVersionId && published),
      published ? `Revision ${published.revision}` : "No published content revision",
    );
    if (!published) continue;
    try {
      const payload = parseStoredPayload(published.payloadJson) as any;
      const validControl = variant?.isControl && payload?.preserveExisting === true;
      const validGallery = !variant?.isControl
        && Array.isArray(payload?.items)
        && payload.items.length > 0
        && new Set(payload.items.map((item: any) => item.id)).size === payload.items.length
        && payload.items.every((item: any) => typeof item.src === "string" && item.src.startsWith("https://"));
      add(
        `content_${allocation.variantId}`,
        `${variant?.name ?? allocation.variantId} content is valid`,
        Boolean(validControl || validGallery),
        validControl ? "Current element preserved" : `${payload?.items?.length ?? 0} secure, unique gallery items`,
      );
    } catch (error: any) {
      add(`content_${allocation.variantId}`, `${variant?.name ?? allocation.variantId} content is valid`, false, error.message || "Invalid content");
    }
  }

  let allocationQaPassed = false;
  try {
    const qa = simulateElementAllocation(experiment.allocations, experiment.id, experiment.allocationVersion, 20_000, "production-preflight");
    allocationQaPassed = qa.deterministicReplayPassed
      && qa.totalAssigned === qa.sampleSize
      && qa.rows.every(row => Math.abs(row.deviationPercentagePoints) <= 1.5);
    add("allocation_qa", "Deterministic traffic simulation", allocationQaPassed, `${qa.totalAssigned.toLocaleString()} assignments; max deviation ${Math.max(...qa.rows.map(row => Math.abs(row.deviationPercentagePoints))).toFixed(3)}pp`);
  } catch (error: any) {
    add("allocation_qa", "Deterministic traffic simulation", false, error.message || "Allocation simulation failed");
  }

  const pixelReady = !getShopifyConfig().liveConnect || workerEnvValue("SHOPIFY_PIXEL_INGEST_ENABLED") === "true";
  add("checkout_attribution", "Shopify checkout attribution enabled", pixelReady, pixelReady ? "Checkout and paid-order joins enabled" : "SHOPIFY_PIXEL_INGEST_ENABLED must be true");

  const warnings = [];
  if (!workerEnvValue("POSTHOG_PROJECT_API_KEY")) warnings.push("PostHog server capture is not configured; Shopify paid-order reporting remains available in Funnel Control.");
  if (!experiment.posthogFlagKey) warnings.push("No PostHog flag key is attached to this experiment.");

  return {
    pass: checks.every(check => check.pass),
    experimentId: experiment.id,
    experimentKey: experiment.key,
    status: experiment.status,
    checks,
    warnings,
    generatedAt: new Date().toISOString(),
  };
}

elementAdminRouter.get("/element-slots", async (req, res) => {
  try {
    const shop = await getOrCreateShop();
    const pathFilter = req.query.pagePath ? pagePath(req.query.pagePath) : undefined;
    const slots = await prisma.elementSlot.findMany({
      where: { shopId: shop.id, ...(pathFilter ? { pagePath: pathFilter } : {}) },
      include: slotInclude,
      orderBy: { updatedAt: "desc" },
    });
    res.json(slots.map(publicSlot));
  } catch (error: any) {
    res.status(400).json({ error: error.message || "Failed to list element slots." });
  }
});

elementAdminRouter.get("/element-slots/:id", async (req, res) => {
  const slot = await prisma.elementSlot.findUnique({ where: { id: req.params.id }, include: slotInclude });
  if (!slot) return res.status(404).json({ error: "Element slot not found." });
  return res.json(publicSlot(slot));
});

elementAdminRouter.get("/element-experiments/:id/results", async (req, res) => {
  try {
    const experiment = await prisma.elementExperiment.findUnique({
      where: { id: req.params.id },
      include: {
        slot: { include: { variants: true } },
        exposures: { select: { visitorId: true, variantId: true, isInternal: true } },
        checkoutAttributions: { select: { checkoutToken: true, visitorId: true, variantId: true } },
        orderAttributions: {
          select: {
            variantId: true,
            order: { select: { id: true, currency: true, netRevenueAmount: true, isTest: true, status: true } },
          },
        },
      },
    });
    if (!experiment) return res.status(404).json({ error: "Element experiment not found." });
    const results = buildElementExperimentResults({
      variants: experiment.slot.variants.map(variant => ({
        id: variant.id,
        key: variant.key,
        name: variant.name,
        isControl: variant.isControl,
      })),
      exposures: experiment.exposures,
      checkouts: experiment.checkoutAttributions,
      orders: experiment.orderAttributions.map(attribution => ({
        orderId: attribution.order.id,
        variantId: attribution.variantId,
        currency: attribution.order.currency,
        netRevenueAmount: attribution.order.netRevenueAmount,
        isTest: attribution.order.isTest,
        status: attribution.order.status,
      })),
    });
    return res.json({
      experimentId: experiment.id,
      experimentKey: experiment.key,
      status: experiment.status,
      startedAt: experiment.startedAt,
      endedAt: experiment.endedAt,
      sourceOfTruth: "SHOPIFY_PAID_ORDERS",
      ...results,
    });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || "Failed to load element experiment results." });
  }
});

elementAdminRouter.get("/element-experiments/:id/allocation-qa", async (req, res) => {
  try {
    const experiment = await prisma.elementExperiment.findUnique({
      where: { id: req.params.id },
      include: {
        allocations: true,
        slot: { include: { variants: true } },
      },
    });
    if (!experiment) return res.status(404).json({ error: "Element experiment not found." });
    const requestedSampleSize = Number(req.query.sampleSize ?? 20_000);
    const seedPrefix = String(req.query.seed ?? "gallery-allocation-qa").trim().slice(0, 80) || "gallery-allocation-qa";
    const report = simulateElementAllocation(
      experiment.allocations,
      experiment.id,
      experiment.allocationVersion,
      requestedSampleSize,
      seedPrefix,
    );
    const variantNames = new Map(experiment.slot.variants.map(variant => [variant.id, variant.name]));
    return res.json({
      ...report,
      rows: report.rows.map(row => ({ ...row, variantName: variantNames.get(row.variantId) ?? row.variantId })),
      sampleAssignments: report.sampleAssignments.map(row => ({
        ...row,
        variantName: variantNames.get(row.variantId) ?? row.variantId,
      })),
      note: "This deterministic dry run writes no assignments or exposures and does not pollute production reporting.",
    });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || "Failed to verify traffic allocation." });
  }
});

elementAdminRouter.get("/element-experiments/:id/preflight", async (req, res) => {
  try {
    const report = await buildElementPreflight(req.params.id);
    if (!report) return res.status(404).json({ error: "Element experiment not found." });
    return res.json(report);
  } catch (error: any) {
    return res.status(400).json({ error: error.message || "Failed to run experiment preflight." });
  }
});

elementAdminRouter.post("/element-slots", async (req, res) => {
  try {
    const shop = await getOrCreateShop();
    const normalizedPath = pagePath(req.body.pagePath);
    const normalizedKey = slotKey(req.body.slotKey);
    const normalizedSelector = targetSelector(req.body.targetSelector, normalizedKey);
    const name = String(req.body.name ?? "").trim().slice(0, 120);
    if (!name) return res.status(400).json({ error: "Slot name is required." });

    const template = await prisma.elementTemplate.upsert({
        where: { shopId_key: { shopId: shop.id, key: GALLERY_TEMPLATE_KEY } },
        update: { schemaJson: JSON.stringify(GALLERY_TEMPLATE_SCHEMA), schemaVersion: 1 },
        create: {
          shopId: shop.id,
          key: GALLERY_TEMPLATE_KEY,
          name: "Product gallery",
          type: "GALLERY",
          schemaVersion: 1,
          schemaJson: JSON.stringify(GALLERY_TEMPLATE_SCHEMA),
        },
      });
    const slotId = randomUUID();
    const controlId = randomUUID();
    const controlVersionId = randomUUID();
    const challengerId = randomUUID();
    const experimentId = randomUUID();
    const experimentKey = `${normalizedPath.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "")}_${normalizedKey.replace(/[^a-z0-9]+/g, "_")}_v1`;
    try {
      await prisma.elementSlot.create({
        data: {
          id: slotId,
          shopId: shop.id,
          templateId: template.id,
          pagePath: normalizedPath,
          slotKey: normalizedKey,
          name,
          targetSelector: normalizedSelector,
        },
      });
      await prisma.elementVariant.create({
        data: { id: controlId, slotId, key: "control", name: "Control", isControl: true },
      });
      await prisma.elementVariantVersion.create({
        data: {
          id: controlVersionId,
          variantId: controlId,
          revision: 1,
          state: "PUBLISHED",
          payloadJson: normalizeElementPayload("GALLERY", { preserveExisting: true }),
          publishedAt: new Date(),
        },
      });
      await prisma.elementVariant.update({ where: { id: controlId }, data: { publishedVersionId: controlVersionId } });
      await prisma.elementVariant.create({
        data: { id: challengerId, slotId, key: "variant-b", name: "Variant B", isControl: false },
      });
      await prisma.elementVariantVersion.create({
        data: {
          variantId: challengerId,
          revision: 1,
          state: "DRAFT",
          payloadJson: JSON.stringify({ preserveExisting: false, initialIndex: 0, showThumbnails: true, items: [] }),
        },
      });
      await prisma.elementExperiment.create({
        data: {
          id: experimentId,
          slotId,
          key: experimentKey,
          posthogFlagKey: experimentKey,
          status: "DRAFT",
          allocations: {
            create: [
              { variantId: controlId, weightBasisPoints: 5000 },
              { variantId: challengerId, weightBasisPoints: 5000 },
            ],
          },
        },
      });
    } catch (error) {
      await prisma.elementSlot.deleteMany({ where: { id: slotId } }).catch(() => undefined);
      throw error;
    }

    const slot = await prisma.elementSlot.findUniqueOrThrow({ where: { id: slotId }, include: slotInclude });
    res.status(201).json(publicSlot(slot));
  } catch (error: any) {
    const message = error?.code === "P2002" ? "A slot or experiment with this key already exists." : error.message;
    res.status(400).json({ error: message || "Failed to create element slot." });
  }
});

elementAdminRouter.patch("/element-slots/:id", async (req, res) => {
  try {
    const slot = await prisma.elementSlot.findUnique({ where: { id: req.params.id }, include: { experiment: true } });
    if (!slot) return res.status(404).json({ error: "Element slot not found." });
    if (slot.experiment?.status === "RUNNING") {
      return res.status(409).json({ error: "Pause the experiment before changing its element selector." });
    }
    const name = req.body.name === undefined ? slot.name : String(req.body.name ?? "").trim().slice(0, 120);
    if (!name) return res.status(400).json({ error: "Slot name is required." });
    const updated = await prisma.elementSlot.update({
      where: { id: slot.id },
      data: { name, targetSelector: targetSelector(req.body.targetSelector, slot.slotKey) },
      include: slotInclude,
    });
    return res.json(publicSlot(updated));
  } catch (error: any) {
    return res.status(400).json({ error: error.message || "Failed to update element slot." });
  }
});

elementAdminRouter.patch("/element-variants/:id", async (req, res) => {
  const name = String(req.body.name ?? "").trim().slice(0, 120);
  if (!name) return res.status(400).json({ error: "Variant name is required." });
  const variant = await prisma.elementVariant.update({ where: { id: req.params.id }, data: { name } });
  return res.json(variant);
});

elementAdminRouter.put("/element-variants/:id/content", async (req, res) => {
  try {
    const variant = await prisma.elementVariant.findUnique({
      where: { id: req.params.id },
      include: { slot: { include: { template: true } }, versions: { orderBy: { revision: "desc" }, take: 1 } },
    });
    if (!variant) return res.status(404).json({ error: "Element variant not found." });
    if (variant.isControl && req.body.payload?.preserveExisting !== true) {
      return res.status(400).json({ error: "The control variant must preserve the existing element." });
    }
    const payloadJson = normalizeElementPayload(variant.slot.template.type, req.body.payload);
    const revision = (variant.versions[0]?.revision ?? 0) + 1;
    const version = await prisma.elementVariantVersion.create({
      data: { variantId: variant.id, revision, state: "DRAFT", payloadJson },
    });
    res.json({ ...version, payload: parseJson(version.payloadJson), payloadJson: undefined });
  } catch (error: any) {
    res.status(400).json({ error: error.message || "Failed to save variant content." });
  }
});

elementAdminRouter.post("/element-variants/:id/publish", async (req, res) => {
  try {
    const latest = await prisma.elementVariantVersion.findFirst({
      where: { variantId: req.params.id },
      orderBy: { revision: "desc" },
    });
    if (!latest) return res.status(400).json({ error: "No variant version exists." });
    await prisma.elementVariantVersion.updateMany({
        where: { variantId: req.params.id, state: "PUBLISHED" },
        data: { state: "ARCHIVED" },
      });
    const published = await prisma.elementVariantVersion.update({
        where: { id: latest.id },
        data: { state: "PUBLISHED", publishedAt: new Date() },
      });
    await prisma.elementVariant.update({
        where: { id: req.params.id },
        data: { publishedVersionId: latest.id },
      });
    res.json({ ...published, payload: parseJson(published.payloadJson), payloadJson: undefined });
  } catch (error: any) {
    res.status(400).json({ error: error.message || "Failed to publish element variant." });
  }
});

elementAdminRouter.patch("/element-experiments/:id/allocations", async (req, res) => {
  try {
    const experiment = await prisma.elementExperiment.findUnique({
      where: { id: req.params.id },
      include: { slot: { include: { variants: true } } },
    });
    if (!experiment) return res.status(404).json({ error: "Element experiment not found." });
    if (!["DRAFT", "PAUSED"].includes(experiment.status)) return res.status(409).json({ error: "Pause the experiment before changing traffic weights." });
    const allocations = Array.isArray(req.body.allocations) ? req.body.allocations : [];
    const validVariantIds = new Set(experiment.slot.variants.map(variant => variant.id));
    const allocationVariantIds = allocations.map((allocation: any) => String(allocation.variantId));
    const weights = allocations.map((allocation: any) => Number(allocation.weightBasisPoints));
    const total = weights.reduce((sum: number, allocationWeight: number) => sum + allocationWeight, 0);
    if (allocations.length < 2 || total !== ELEMENT_BASIS_POINTS_TOTAL) {
      return res.status(400).json({ error: `At least two allocations totaling ${ELEMENT_BASIS_POINTS_TOTAL} basis points are required.` });
    }
    if (new Set(allocationVariantIds).size !== allocationVariantIds.length) {
      return res.status(400).json({ error: "Each variant can appear only once in an allocation." });
    }
    if (allocations.some((allocation: any, index: number) => !validVariantIds.has(String(allocation.variantId)) || !Number.isInteger(weights[index]) || weights[index] < 0)) {
      return res.status(400).json({ error: "Every allocation must reference a variant in this slot and use a non-negative integer weight." });
    }
    await prisma.elementExperimentAllocation.deleteMany({ where: { experimentId: experiment.id } });
    await prisma.elementExperimentAllocation.createMany({
        data: allocations.map((allocation: any) => ({
          experimentId: experiment.id,
          variantId: String(allocation.variantId),
          weightBasisPoints: Number(allocation.weightBasisPoints),
        })),
      });
    const updated = await prisma.elementExperiment.update({
        where: { id: experiment.id },
        data: { allocationVersion: { increment: 1 } },
        include: { allocations: true },
      });
    res.json(updated);
  } catch (error: any) {
    res.status(400).json({ error: error.message || "Failed to update experiment allocations." });
  }
});

elementAdminRouter.post("/element-experiments/:id/start", async (req, res) => {
  try {
    const preflight = await buildElementPreflight(req.params.id);
    if (!preflight) return res.status(404).json({ error: "Element experiment not found." });
    if (!preflight.pass) return res.status(409).json({ error: "Experiment preflight failed.", preflight });
    const experiment = await prisma.elementExperiment.findUnique({
      where: { id: req.params.id },
      include: { allocations: true, slot: { include: { variants: true } } },
    });
    if (!experiment) return res.status(404).json({ error: "Element experiment not found." });
    if (!["DRAFT", "PAUSED"].includes(experiment.status)) return res.status(409).json({ error: "Only a draft or paused experiment can start." });
    if (experiment.allocations.reduce((sum, allocation) => sum + allocation.weightBasisPoints, 0) !== ELEMENT_BASIS_POINTS_TOTAL) {
      return res.status(400).json({ error: "Traffic allocations must total 100%." });
    }
    const allocatedIds = new Set(experiment.allocations.filter(item => item.weightBasisPoints > 0).map(item => item.variantId));
    const missingPublished = experiment.slot.variants.filter(variant => allocatedIds.has(variant.id) && !variant.publishedVersionId);
    if (missingPublished.length > 0) {
      return res.status(400).json({ error: `Publish every allocated variant before starting: ${missingPublished.map(item => item.name).join(", ")}.` });
    }
    const updated = await prisma.elementExperiment.update({
        where: { id: experiment.id },
        data: { status: "RUNNING", startedAt: new Date(), endedAt: null },
        include: { allocations: true },
      });
    await prisma.elementSlot.update({ where: { id: experiment.slotId }, data: { status: "ACTIVE" } });
    res.json(updated);
  } catch (error: any) {
    res.status(400).json({ error: error.message || "Failed to start element experiment." });
  }
});

elementAdminRouter.post("/element-experiments/:id/pause", async (req, res) => {
  const experiment = await prisma.elementExperiment.findUnique({ where: { id: req.params.id } });
  if (!experiment) return res.status(404).json({ error: "Element experiment not found." });
  await prisma.elementSlot.update({ where: { id: experiment.slotId }, data: { status: "DRAFT" } });
  const updated = await prisma.elementExperiment.update({ where: { id: experiment.id }, data: { status: "PAUSED" } });
  return res.json(updated);
});

elementAdminRouter.post("/element-experiments/:id/promote/:variantId", async (req, res) => {
  try {
    const experiment = await prisma.elementExperiment.findUnique({
      where: { id: req.params.id },
      include: { slot: { include: { variants: true } } },
    });
    if (!experiment) return res.status(404).json({ error: "Element experiment not found." });
    const winner = experiment.slot.variants.find(variant => variant.id === req.params.variantId);
    if (!winner || !winner.publishedVersionId) return res.status(400).json({ error: "Winner must be a published variant in this slot." });
    await prisma.elementSlot.update({ where: { id: experiment.slotId }, data: { status: "DRAFT" } });
    await prisma.elementExperimentAllocation.deleteMany({ where: { experimentId: experiment.id } });
    await prisma.elementExperimentAllocation.create({
        data: { experimentId: experiment.id, variantId: winner.id, weightBasisPoints: ELEMENT_BASIS_POINTS_TOTAL },
      });
    const updated = await prisma.elementExperiment.update({
        where: { id: experiment.id },
        data: { status: "COMPLETED", endedAt: new Date(), allocationVersion: { increment: 1 } },
      });
    await prisma.elementSlot.update({ where: { id: experiment.slotId }, data: { status: "ACTIVE" } });
    res.json(updated);
  } catch (error: any) {
    res.status(400).json({ error: error.message || "Failed to promote element variant." });
  }
});

elementRuntimeRouter.get("/element-runtime/:slotKey", async (req, res) => {
  try {
    const config = getShopifyConfig();
    if (config.liveConnect && !verifyShopifyAppProxyRequest(req)) {
      return res.status(401).json({ error: "Signed Shopify App Proxy request required." });
    }
    const visitorKey = String(req.query.visitor_id ?? "").trim();
    if (visitorKey.length < 8 || visitorKey.length > 200) return res.status(400).json({ error: "A valid anonymous visitor id is required." });
    const normalizedPath = pagePath(req.query.page);
    const normalizedKey = slotKey(req.params.slotKey);
    const shop = await prisma.shop.findUnique({ where: { domain: configuredShopDomain() } });
    if (!shop) return res.json({ active: false, reason: "shop_not_configured" });
    const slot = await prisma.elementSlot.findUnique({
      where: { shopId_pagePath_slotKey: { shopId: shop.id, pagePath: normalizedPath, slotKey: normalizedKey } },
      include: { template: true },
    });
    if (!slot || slot.status !== "ACTIVE") return res.json({ active: false, reason: "slot_inactive" });

    const selection = await selectElementVariant(slot.id, shop.id, visitorKey);
    if (!selection) return res.json({ active: false, reason: "experiment_inactive" });
    let variant = await prisma.elementVariant.findUnique({ where: { id: selection.variantId } });
    if (!variant?.publishedVersionId) {
      variant = await prisma.elementVariant.findFirst({ where: { slotId: slot.id, isControl: true, publishedVersionId: { not: null } } });
    }
    if (!variant?.publishedVersionId) return res.json({ active: false, reason: "no_published_variant" });
    const version = await prisma.elementVariantVersion.findUnique({ where: { id: variant.publishedVersionId } });
    if (!version) return res.json({ active: false, reason: "published_version_missing" });

    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    return res.json({
      active: true,
      slotId: slot.id,
      slotKey: slot.slotKey,
      selector: slot.targetSelector,
      templateType: slot.template.type,
      templateVersion: slot.template.schemaVersion,
      experimentId: selection.experimentId,
      experimentKey: selection.experimentKey,
      posthogFlagKey: selection.posthogFlagKey,
      allocationVersion: selection.allocationVersion,
      assignmentId: selection.assignmentId,
      variantId: variant.id,
      variantKey: variant.key,
      variantName: variant.name,
      isControl: variant.isControl,
      contentRevision: version.revision,
      payload: parseStoredPayload(version.payloadJson),
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message || "Failed to resolve element experiment." });
  }
});

elementRuntimeRouter.post("/element-exposure", async (req, res) => {
  try {
    const config = getShopifyConfig();
    if (config.liveConnect && !verifyShopifyAppProxyRequest(req)) {
      return res.status(401).json({ error: "Signed Shopify App Proxy request required." });
    }
    const eventId = String(req.body.eventId ?? "").trim();
    const visitorKey = String(req.body.visitorId ?? "").trim();
    const assignmentId = String(req.body.assignmentId ?? "").trim();
    const experimentId = String(req.body.experimentId ?? "").trim();
    const variantId = String(req.body.variantId ?? "").trim();
    const requestedSlotId = String(req.body.slotId ?? "").trim();
    if (!/^[a-zA-Z0-9_-]{8,120}$/.test(eventId) || visitorKey.length < 8 || visitorKey.length > 200) {
      return res.status(400).json({ error: "A valid exposure event and visitor id are required." });
    }
    const shop = await prisma.shop.findUnique({ where: { domain: configuredShopDomain() } });
    if (!shop) return res.status(404).json({ error: "Shop is not configured." });
    const assignment = await prisma.elementAssignment.findFirst({
      where: {
        id: assignmentId,
        experimentId,
        variantId,
        visitor: { shopId: shop.id, anonymousKeyHash: hashAnonymousKey(visitorKey) },
        experiment: { slotId: requestedSlotId },
      },
      include: { experiment: { include: { slot: true } }, variant: true },
    });
    if (!assignment) return res.status(400).json({ error: "Exposure does not match a valid assignment." });
    const existing = await prisma.elementExposure.findUnique({ where: { eventId } });
    if (existing) return res.json({ accepted: true, duplicate: true });
    const isInternal = req.body.isInternal === true;
    await prisma.elementExposure.create({
      data: {
        eventId,
        shopId: shop.id,
        slotId: requestedSlotId,
        visitorId: assignment.visitorId,
        assignmentId: assignment.id,
        experimentId: assignment.experimentId,
        variantId: assignment.variantId,
        isInternal,
      },
    });
    await captureElementExposureToPostHog(assignment.visitorId, {
      eventId,
      assignmentId: assignment.id,
      allocationVersion: assignment.allocationVersion,
      experimentId: assignment.experimentId,
      experimentKey: assignment.experiment.key,
      posthogFlagKey: assignment.experiment.posthogFlagKey,
      variantId: assignment.variantId,
      variantKey: assignment.variant.key,
      slotId: assignment.experiment.slotId,
      slotKey: assignment.experiment.slot.slotKey,
      pagePath: assignment.experiment.slot.pagePath,
      isInternal,
    });
    return res.status(201).json({ accepted: true, duplicate: false });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || "Failed to record element exposure." });
  }
});

elementRuntimeRouter.post("/element-cart-attribution", async (req, res) => {
  try {
    const config = getShopifyConfig();
    if (config.liveConnect && !verifyShopifyAppProxyRequest(req)) {
      return res.status(401).json({ error: "Signed Shopify App Proxy request required." });
    }
    const visitorKey = String(req.body.visitorId ?? "").trim();
    const cartToken = normalizeShopifyCartToken(req.body.cartToken);
    const contexts = normalizeElementAssignmentContexts(req.body.elementAssignments);
    if (visitorKey.length < 8 || visitorKey.length > 200 || !cartToken || contexts.length === 0) {
      return res.status(400).json({ error: "A valid cart, visitor, and element assignment are required." });
    }
    const shop = await prisma.shop.findUnique({ where: { domain: configuredShopDomain() } });
    if (!shop) return res.status(404).json({ error: "Shop is not configured." });
    const visitor = await resolveBrowserVisitor(shop.id, visitorKey);
    if (!visitor) return res.status(400).json({ error: "A valid visitor is required." });
    const captured = await snapshotCartElementAssignments({
      shopId: shop.id,
      cartToken,
      visitorId: visitor.id,
      contexts,
    });
    if (captured === 0) return res.status(400).json({ error: "No matching element assignment was found." });
    return res.status(201).json({ accepted: true, captured });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || "Failed to record cart attribution." });
  }
});
