import prisma from "./db.js";
import { ensureBotShop } from "./bot-runtime-store.js";

interface ModelAccumulator {
  conversations: Set<string>;
  messages: number;
  latencyTotal: number;
  latencyCount: number;
  estimatedCostUsd: number;
  unknownCostCalls: number;
  atc: number;
  checkouts: number;
  purchases: number;
  revenueIls: number;
  contributionProfitIls: number;
  contributionProfitKnownPurchases: number;
}

function payload(value: string): Record<string, any> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function modelKey(provider: unknown, model: unknown): string | null {
  const p = String(provider || "").trim();
  const m = String(model || "").trim();
  return p && m ? `${p}:${m}` : null;
}

function newAccumulator(): ModelAccumulator {
  return {
    conversations: new Set(), messages: 0, latencyTotal: 0, latencyCount: 0,
    estimatedCostUsd: 0, unknownCostCalls: 0, atc: 0, checkouts: 0,
    purchases: 0, revenueIls: 0, contributionProfitIls: 0, contributionProfitKnownPurchases: 0,
  };
}

export async function buildBotAnalytics(shopDomain: string, since: Date) {
  const shop = await ensureBotShop(shopDomain);
  const rows = await prisma.event.findMany({
    where: {
      shopId: shop.id,
      occurredAt: { gte: since },
      OR: [
        { name: { startsWith: "BOT_" } },
        { name: { startsWith: "bot_" } },
      ],
    },
    orderBy: { occurredAt: "asc" },
  });

  const counters: Record<string, number> = {};
  const models: Record<string, ModelAccumulator> = {};
  const conversations = new Set<string>();

  for (const row of rows) {
    counters[row.name] = (counters[row.name] || 0) + 1;
    const data = payload(row.payload);
    const conversationId = String(data.conversationId || "");
    if (conversationId) conversations.add(conversationId);
    const key = modelKey(data.provider, data.model);
    if (!key) continue;
    models[key] ||= newAccumulator();
    const acc = models[key];
    if (conversationId) acc.conversations.add(conversationId);

    if (row.name === "bot_model_response") {
      acc.messages += 1;
      if (Number.isFinite(Number(data.latencyMs))) {
        acc.latencyTotal += Number(data.latencyMs);
        acc.latencyCount += 1;
      }
      if (data.estimatedCostUsd == null || !Number.isFinite(Number(data.estimatedCostUsd))) acc.unknownCostCalls += 1;
      else acc.estimatedCostUsd += Number(data.estimatedCostUsd);
    }

    if (row.name === "bot_atc") acc.atc += 1;
    if (row.name === "bot_checkout") acc.checkouts += 1;
    if (row.name === "bot_purchase_attributed") {
      acc.purchases += 1;
      if (Number.isFinite(Number(data.revenueIls))) acc.revenueIls += Number(data.revenueIls);
      if (data.contributionProfitIls != null && Number.isFinite(Number(data.contributionProfitIls))) {
        acc.contributionProfitIls += Number(data.contributionProfitIls);
        acc.contributionProfitKnownPurchases += 1;
      }
    }
  }

  const modelRows = Object.fromEntries(Object.entries(models).map(([key, acc]) => {
    const conversationCount = acc.conversations.size;
    return [key, {
      conversations: conversationCount,
      messages: acc.messages,
      avgLatencyMs: acc.latencyCount ? Math.round(acc.latencyTotal / acc.latencyCount) : null,
      estimatedCostUsd: Number(acc.estimatedCostUsd.toFixed(6)),
      aiCostComplete: acc.unknownCostCalls === 0,
      unknownCostCalls: acc.unknownCostCalls,
      atc: acc.atc,
      checkouts: acc.checkouts,
      purchases: acc.purchases,
      conversionRate: conversationCount ? Number(((acc.purchases / conversationCount) * 100).toFixed(2)) : 0,
      revenueIls: Number(acc.revenueIls.toFixed(2)),
      contributionProfitIls: acc.contributionProfitKnownPurchases === acc.purchases ? Number(acc.contributionProfitIls.toFixed(2)) : null,
      contributionProfitCoverage: acc.purchases ? Number(((acc.contributionProfitKnownPurchases / acc.purchases) * 100).toFixed(2)) : 100,
    }];
  }));

  return {
    conversations: conversations.size,
    counters,
    models: modelRows,
    caveats: {
      commerceSource: "STAGING_ONLY_UNTIL_STOREFRONT_ATTRIBUTION_IS_ENABLED",
      aiCost: "Estimated only when BOT_MODEL_PRICING_JSON contains exact provider:model pricing.",
      contributionProfit: "Null unless every attributed purchase for that model includes contribution profit from an authoritative source.",
    },
  };
}
