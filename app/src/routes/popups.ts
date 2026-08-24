import { createHash, randomUUID } from "node:crypto";
import { Router } from "express";
import prisma from "../lib/db.js";
import { defaultPopupCampaign, normalizeAndValidatePopupCampaign, type PopupCampaignConfig } from "../lib/popup-config-contract.js";
import { evaluatePopupEligibility, type PopupSessionContext } from "../lib/popup-engine.js";
import {
  classifyCommerceTraffic,
  DEFAULT_TIGER_COMMERCE_TRAFFIC_POLICY,
  type CommerceTrafficSignals,
} from "../lib/popup-commerce-traffic.js";

const router = Router();

const ALLOWED_EVENT_NAMES = new Set([
  "popup_eligible",
  "popup_impression",
  "popup_close",
  "popup_cta_click",
  "popup_submit",
  "popup_coupon_reveal",
  "popup_add_to_cart",
  "popup_checkout",
  "popup_purchase",
  "popup_error",
]);

const PRIVATE_METADATA_KEYS = new Set([
  "email",
  "phone",
  "telephone",
  "name",
  "firstName",
  "lastName",
  "address",
  "customerId",
  "customer_id",
  "orderNumber",
  "order_number",
]);

// These values are server-derived business classifications. A browser event is
// not allowed to self-declare them as factual analytics dimensions.
const UNTRUSTED_DERIVED_METADATA_KEYS = new Set([
  "commerceTrafficClass",
  "commerce_traffic_class",
  "commerceTrafficDecision",
  "commerce_traffic_decision",
  "qualifiedCommerceTraffic",
  "qualified_commerce_traffic",
]);

function currentShopDomain(): string {
  return String(process.env.SHOP_DOMAIN || "local-dev.myshopify.com").trim().toLowerCase();
}

function popupRuntimeState() {
  return {
    stagingEnabled: process.env.POPUP_STAGING_ENABLED === "true",
    eventIngestEnabled: process.env.POPUP_STAGING_EVENT_INGEST === "true",
    storefrontEnabled: false,
    killSwitch: process.env.POPUP_KILL_SWITCH !== "false",
    boundary: "STAGING_ONLY",
    commerceTrafficPolicyVersion: DEFAULT_TIGER_COMMERCE_TRAFFIC_POLICY.version,
  } as const;
}

function safeJson(value: string, fallback: unknown): any {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function rowToConfig(row: any): PopupCampaignConfig {
  const candidate = {
    key: row.key,
    name: row.name,
    type: row.type,
    status: row.status,
    experimentVersion: row.experimentVersion,
    trigger: safeJson(row.triggerJson, {}),
    targeting: safeJson(row.targetingJson, {}),
    frequency: safeJson(row.frequencyJson, {}),
    safety: safeJson(row.safetyJson, {}),
    variants: (row.variants || []).map((variant: any) => ({
      key: variant.key,
      name: variant.name,
      weightBasisPoints: variant.weightBasisPoints,
      creative: safeJson(variant.creativeJson, {}),
    })),
  };
  const validated = normalizeAndValidatePopupCampaign(candidate);
  if (!validated.ok || !validated.config) throw new Error(`Stored popup campaign ${row.key} is invalid: ${validated.errors.join(" ")}`);
  return validated.config;
}

async function loadCampaign(key: string) {
  return prisma.popupCampaign.findUnique({
    where: { shopDomain_key: { shopDomain: currentShopDomain(), key } },
    include: { variants: { orderBy: { createdAt: "asc" } } },
  });
}

function stripPrivateMetadata(value: unknown, depth = 0): unknown {
  if (depth > 3) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 25).map(item => stripPrivateMetadata(item, depth + 1));
  if (!value || typeof value !== "object") {
    if (typeof value === "string") return value.slice(0, 500);
    if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
    return undefined;
  }
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
    if (PRIVATE_METADATA_KEYS.has(key) || UNTRUSTED_DERIVED_METADATA_KEYS.has(key)) continue;
    output[key.slice(0, 80)] = stripPrivateMetadata(item, depth + 1);
  }
  return output;
}

function hashIdentifier(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  const pepper = process.env.POPUP_EVENT_HASH_PEPPER || process.env.SHOPIFY_CLIENT_SECRET || "";
  if (!pepper) throw new Error("POPUP_EVENT_HASH_PEPPER is required before popup event ingestion can be enabled");
  return createHash("sha256").update(`${pepper}:${text}`).digest("hex");
}

function normalizeCountries(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_TIGER_COMMERCE_TRAFFIC_POLICY.targetCountries];
  const countries = [...new Set(value
    .filter(item => typeof item === "string")
    .map(item => item.trim().toUpperCase())
    .filter(item => /^[A-Z]{2}$/.test(item)))].slice(0, 50);
  return countries.length ? countries : [...DEFAULT_TIGER_COMMERCE_TRAFFIC_POLICY.targetCountries];
}

router.get("/popups/status", (_req, res) => {
  res.json(popupRuntimeState());
});

// Private deterministic classifier for operator QA. This does not use an LLM,
// trust a browser-supplied classification, or publish anything to the storefront.
router.post("/popups/commerce-traffic/evaluate", (req, res) => {
  const signals = (req.body?.signals || req.body?.context || {}) as CommerceTrafficSignals;
  const policy = {
    version: DEFAULT_TIGER_COMMERCE_TRAFFIC_POLICY.version,
    targetCountries: normalizeCountries(req.body?.targetCountries),
  };
  res.json({
    classification: classifyCommerceTraffic(signals, policy),
    policy,
    simulatorOnly: true,
    runtime: popupRuntimeState(),
  });
});

router.get("/popups/config", async (_req, res) => {
  try {
    const rows = await prisma.popupCampaign.findMany({
      where: { shopDomain: currentShopDomain() },
      include: { variants: { orderBy: { createdAt: "asc" } } },
      orderBy: { updatedAt: "desc" },
    });
    res.json({
      campaigns: rows.map(rowToConfig),
      defaultCampaign: defaultPopupCampaign(),
      runtime: popupRuntimeState(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Failed to load popup campaigns" });
  }
});

router.put("/popups/campaigns/:key", async (req, res) => {
  const candidate = { ...(req.body || {}), key: req.params.key };
  const validated = normalizeAndValidatePopupCampaign(candidate);
  if (!validated.ok || !validated.config) {
    return res.status(400).json({ error: "Invalid popup campaign", details: validated.errors });
  }

  const config = validated.config;
  const shopDomain = currentShopDomain();
  try {
    const saved = await prisma.$transaction(async tx => {
      const campaign = await tx.popupCampaign.upsert({
        where: { shopDomain_key: { shopDomain, key: config.key } },
        create: {
          shopDomain,
          key: config.key,
          name: config.name,
          type: config.type,
          status: config.status,
          experimentVersion: config.experimentVersion,
          triggerJson: JSON.stringify(config.trigger),
          targetingJson: JSON.stringify(config.targeting),
          frequencyJson: JSON.stringify(config.frequency),
          safetyJson: JSON.stringify(config.safety),
        },
        update: {
          name: config.name,
          type: config.type,
          status: config.status,
          experimentVersion: config.experimentVersion,
          triggerJson: JSON.stringify(config.trigger),
          targetingJson: JSON.stringify(config.targeting),
          frequencyJson: JSON.stringify(config.frequency),
          safetyJson: JSON.stringify(config.safety),
        },
      });
      await tx.popupVariant.deleteMany({ where: { popupCampaignId: campaign.id } });
      for (const variant of config.variants) {
        await tx.popupVariant.create({
          data: {
            popupCampaignId: campaign.id,
            key: variant.key,
            name: variant.name,
            weightBasisPoints: variant.weightBasisPoints,
            creativeJson: JSON.stringify(variant.creative),
          },
        });
      }
      return tx.popupCampaign.findUnique({
        where: { id: campaign.id },
        include: { variants: { orderBy: { createdAt: "asc" } } },
      });
    });

    res.json({ ok: true, campaign: rowToConfig(saved), runtime: popupRuntimeState() });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Failed to save popup campaign" });
  }
});

router.post("/popups/evaluate", async (req, res) => {
  try {
    const key = String(req.body?.campaignKey || "").trim();
    const row = key ? await loadCampaign(key) : null;
    const campaign = row ? rowToConfig(row) : normalizeAndValidatePopupCampaign(req.body?.campaign || defaultPopupCampaign()).config;
    if (!campaign) return res.status(400).json({ error: "Valid campaign configuration is required" });

    const context = (req.body?.context || {}) as PopupSessionContext;
    const result = evaluatePopupEligibility(campaign, context);
    res.json({
      result,
      campaignKey: campaign.key,
      experimentVersion: campaign.experimentVersion,
      simulatorOnly: true,
      runtime: popupRuntimeState(),
    });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || "Popup evaluation failed" });
  }
});

router.post("/popups/events", async (req, res) => {
  const runtime = popupRuntimeState();
  if (!runtime.stagingEnabled || !runtime.eventIngestEnabled || runtime.killSwitch) {
    return res.status(503).json({ error: "Popup event ingestion is disabled by the staging safety gate", runtime });
  }

  const eventName = String(req.body?.name || "");
  if (!ALLOWED_EVENT_NAMES.has(eventName)) return res.status(400).json({ error: "Unsupported popup event name" });
  const campaignKey = String(req.body?.campaignKey || "").trim();
  const campaign = campaignKey ? await loadCampaign(campaignKey) : null;
  if (!campaign) return res.status(404).json({ error: "Popup campaign not found" });

  const eventKey = String(req.body?.eventKey || randomUUID()).slice(0, 180);
  const occurredAt = new Date(req.body?.occurredAt || Date.now());
  if (Number.isNaN(occurredAt.getTime())) return res.status(400).json({ error: "Invalid occurredAt" });

  try {
    const existing = await prisma.popupEvent.findUnique({ where: { eventKey }, select: { id: true } });
    if (existing) return res.json({ ok: true, duplicate: true });

    await prisma.popupEvent.create({
      data: {
        eventKey,
        shopDomain: currentShopDomain(),
        popupCampaignId: campaign.id,
        campaignKey,
        variantKey: typeof req.body?.variantKey === "string" ? req.body.variantKey.slice(0, 80) : null,
        visitorHash: hashIdentifier(req.body?.visitorId),
        sessionHash: hashIdentifier(req.body?.sessionId),
        name: eventName,
        occurredAt,
        metadataJson: JSON.stringify(stripPrivateMetadata(req.body?.metadata || {})),
        isTest: true,
      },
    });
    res.json({ ok: true, duplicate: false });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Failed to record popup event" });
  }
});

router.get("/popups/analytics", async (req, res) => {
  try {
    const campaignKey = typeof req.query.campaignKey === "string" ? req.query.campaignKey : undefined;
    const rows = await prisma.popupEvent.findMany({
      where: { shopDomain: currentShopDomain(), ...(campaignKey ? { campaignKey } : {}) },
      select: { name: true, campaignKey: true, variantKey: true, occurredAt: true },
      orderBy: { occurredAt: "desc" },
      take: 10_000,
    });
    const totals: Record<string, number> = {};
    const variants: Record<string, Record<string, number>> = {};
    for (const row of rows) {
      totals[row.name] = (totals[row.name] || 0) + 1;
      const variant = row.variantKey || "unassigned";
      variants[variant] ||= {};
      variants[variant][row.name] = (variants[variant][row.name] || 0) + 1;
    }
    res.json({ campaignKey: campaignKey || null, sampleLimited: rows.length === 10_000, totals, variants, runtime: popupRuntimeState() });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Failed to load popup analytics" });
  }
});

export default router;
