import { Router } from "express";
import prisma from "../lib/db.js";
import { getShopifyConfig } from "../lib/shopify-config.js";
import {
  defaultBotConfigurationDraft,
  normalizeAndValidateBotConfiguration,
  type BotConfigurationDraft,
} from "../lib/bot-config-contract.js";
import { buildBotDecisionPlan } from "../lib/bot-orchestrator.js";
import type { BotConversationSignals } from "../lib/bot-sales-brain.js";

const router = Router();

function currentShopDomain(): string {
  return getShopifyConfig().shopDomain || process.env.SHOP_DOMAIN || "local-dev.myshopify.com";
}

function parseJsonObject<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as T : fallback;
  } catch {
    return fallback;
  }
}

async function loadBotConfiguration(): Promise<BotConfigurationDraft> {
  const shopDomain = currentShopDomain();
  const row = await prisma.botConfiguration.findUnique({
    where: { shopDomain },
    include: { modelVariants: { where: { enabled: true }, orderBy: { slot: "asc" } } },
  });
  if (!row) return defaultBotConfigurationDraft();

  const defaults = defaultBotConfigurationDraft();
  const raw = {
    version: 1,
    identity: {
      name: row.name,
      label: row.label,
      welcome: row.welcome,
      placement: row.placement,
    },
    routing: parseJsonObject(row.routingJson, defaults.routing),
    playbook: parseJsonObject(row.playbookJson, defaults.playbook),
    offers: parseJsonObject(row.offersJson, defaults.offers),
    crm: parseJsonObject(row.crmJson, defaults.crm),
    security: parseJsonObject(row.securityJson, defaults.security),
    models: row.modelVariants.map(item => ({
      provider: item.provider,
      model: item.model,
      trafficPct: item.trafficBasisPoints / 100,
    })),
  };

  const validated = normalizeAndValidateBotConfiguration(raw);
  if (!validated.ok || !validated.config) {
    throw new Error(`Stored bot configuration is invalid: ${validated.errors.join(" ")}`);
  }
  return validated.config;
}

router.get("/bot/config", async (_req, res) => {
  try {
    const config = await loadBotConfiguration();
    res.json({
      config,
      persisted: Boolean(await prisma.botConfiguration.findUnique({ where: { shopDomain: currentShopDomain() }, select: { id: true } })),
      storefrontEnabled: false,
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Failed to load bot configuration" });
  }
});

router.put("/bot/config", async (req, res) => {
  const validated = normalizeAndValidateBotConfiguration(req.body);
  if (!validated.ok || !validated.config) {
    return res.status(400).json({ error: "Invalid bot configuration", details: validated.errors });
  }

  const config = validated.config;
  const shopDomain = currentShopDomain();

  try {
    const saved = await prisma.$transaction(async tx => {
      const row = await tx.botConfiguration.upsert({
        where: { shopDomain },
        create: {
          shopDomain,
          status: "DRAFT",
          name: config.identity.name,
          label: config.identity.label,
          welcome: config.identity.welcome,
          placement: config.identity.placement,
          routingJson: JSON.stringify(config.routing),
          playbookJson: JSON.stringify(config.playbook),
          offersJson: JSON.stringify(config.offers),
          crmJson: JSON.stringify(config.crm),
          securityJson: JSON.stringify(config.security),
        },
        update: {
          status: "DRAFT",
          name: config.identity.name,
          label: config.identity.label,
          welcome: config.identity.welcome,
          placement: config.identity.placement,
          routingJson: JSON.stringify(config.routing),
          playbookJson: JSON.stringify(config.playbook),
          offersJson: JSON.stringify(config.offers),
          crmJson: JSON.stringify(config.crm),
          securityJson: JSON.stringify(config.security),
        },
      });

      await tx.botModelVariant.deleteMany({ where: { botConfigurationId: row.id } });
      for (let index = 0; index < config.models.length; index += 1) {
        const model = config.models[index];
        await tx.botModelVariant.create({
          data: {
            botConfigurationId: row.id,
            slot: index,
            provider: model.provider || "custom",
            model: model.model,
            trafficBasisPoints: Math.round(model.trafficPct * 100),
            enabled: true,
          },
        });
      }

      return tx.botConfiguration.findUnique({
        where: { id: row.id },
        include: { modelVariants: { orderBy: { slot: "asc" } } },
      });
    });

    res.json({
      ok: true,
      status: saved?.status || "DRAFT",
      updatedAt: saved?.updatedAt || new Date(),
      storefrontEnabled: false,
      config,
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Failed to save bot configuration" });
  }
});

// Private admin simulator for deterministic policy QA. It does not call any LLM,
// create coupons, access customer orders, or touch the storefront.
router.post("/bot/decision-preview", async (req, res) => {
  try {
    const config = await loadBotConfiguration();
    const visitorKey = String(req.body?.visitorKey || "preview-visitor");
    const signals = (req.body?.signals || {}) as BotConversationSignals;
    const models = config.models.map((item, index) => ({
      id: `configured-${index}`,
      provider: item.provider || "custom",
      model: item.model,
      trafficBasisPoints: Math.round(item.trafficPct * 100),
    }));

    const plan = buildBotDecisionPlan({
      visitorKey,
      signals,
      profile: req.body?.profile || {},
      leadContext: req.body?.leadContext || { customerMessages: Number(signals.customerMessages || 0) },
      models,
    });

    res.json({ plan, storefrontEnabled: false });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || "Failed to evaluate bot policy" });
  }
});

export default router;
