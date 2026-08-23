import { Router } from "express";
import prisma from "../lib/db.js";
import {
  normalizeAndValidateBotConfiguration,
} from "../lib/bot-config-contract.js";
import { buildBotDecisionPlan } from "../lib/bot-orchestrator.js";
import type { BotConversationSignals } from "../lib/bot-sales-brain.js";
import { currentBotShopDomain, loadCurrentBotConfiguration } from "../lib/bot-config-store.js";

const router = Router();

router.get("/bot/config", async (_req, res) => {
  try {
    const config = await loadCurrentBotConfiguration();
    res.json({
      config,
      persisted: Boolean(await prisma.botConfiguration.findUnique({ where: { shopDomain: currentBotShopDomain() }, select: { id: true } })),
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
  const shopDomain = currentBotShopDomain();

  try {
    const saved = await prisma.$transaction(async tx => {
      const playbookStored = {
        ...config.playbook,
        identityExtras: {
          avatarUrl: config.identity.avatarUrl || "",
          subtitle: config.identity.subtitle || "",
          trustLine: config.identity.trustLine || "",
        },
      };
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
          playbookJson: JSON.stringify(playbookStored),
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
          playbookJson: JSON.stringify(playbookStored),
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
    const config = await loadCurrentBotConfiguration();
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
