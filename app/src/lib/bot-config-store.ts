import prisma from "./db.js";
import { getShopifyConfig } from "./shopify-config.js";
import {
  defaultBotConfigurationDraft,
  normalizeAndValidateBotConfiguration,
  type BotConfigurationDraft,
} from "./bot-config-contract.js";

export function currentBotShopDomain(): string {
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

export async function loadCurrentBotConfiguration(): Promise<BotConfigurationDraft> {
  const shopDomain = currentBotShopDomain();
  const row = await prisma.botConfiguration.findUnique({
    where: { shopDomain },
    include: { modelVariants: { where: { enabled: true }, orderBy: { slot: "asc" } } },
  });
  if (!row) return defaultBotConfigurationDraft();

  const defaults = defaultBotConfigurationDraft();
  const playbookStored = parseJsonObject<Record<string, any>>(row.playbookJson, defaults.playbook as any);
  const identityExtras = playbookStored.identityExtras && typeof playbookStored.identityExtras === "object" ? playbookStored.identityExtras : {};
  const raw = {
    version: 1,
    identity: {
      name: row.name,
      label: row.label,
      welcome: row.welcome,
      placement: row.placement,
      avatarUrl: identityExtras.avatarUrl,
      subtitle: identityExtras.subtitle,
      trustLine: identityExtras.trustLine,
    },
    routing: parseJsonObject(row.routingJson, defaults.routing),
    playbook: {
      stages: String(playbookStored.stages ?? defaults.playbook.stages),
      methods: String(playbookStored.methods ?? defaults.playbook.methods),
    },
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
