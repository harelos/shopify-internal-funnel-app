import { createHash, randomUUID } from "node:crypto";
import prisma from "./db.js";
import { ensureBotShop } from "./bot-runtime-store.js";

export interface BotUsageLimits {
  messagesPer5m: number;
  messagesPerHour: number;
}

export class BotGuardrailError extends Error {
  readonly code: string;
  readonly retryAfterSeconds?: number;

  constructor(code: string, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "BotGuardrailError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function visitorHash(visitorKey: string): string {
  return createHash("sha256").update(visitorKey).digest("hex").slice(0, 24);
}

export async function checkAndRecordMessageRate(shopDomain: string, visitorKey: string, limits: BotUsageLimits) {
  if (!visitorKey) throw new BotGuardrailError("VISITOR_KEY_REQUIRED", "Visitor key is required.");
  const shop = await ensureBotShop(shopDomain);
  const hash = visitorHash(visitorKey);
  const prefix = `bot:rate:${shop.id}:${hash}:`;
  const now = new Date();
  const fiveMinutesAgo = new Date(now.getTime() - 5 * 60_000);
  const hourAgo = new Date(now.getTime() - 60 * 60_000);

  const [fiveMinuteCount, hourlyCount] = await Promise.all([
    prisma.event.count({ where: { shopId: shop.id, eventKey: { startsWith: prefix }, occurredAt: { gte: fiveMinutesAgo } } }),
    prisma.event.count({ where: { shopId: shop.id, eventKey: { startsWith: prefix }, occurredAt: { gte: hourAgo } } }),
  ]);

  if (fiveMinuteCount >= limits.messagesPer5m) {
    throw new BotGuardrailError("RATE_LIMIT_5M", "Too many bot messages in a short period.", 300);
  }
  if (hourlyCount >= limits.messagesPerHour) {
    throw new BotGuardrailError("RATE_LIMIT_HOUR", "Hourly bot message limit reached.", 3600);
  }

  await prisma.event.create({
    data: {
      shopId: shop.id,
      eventKey: `${prefix}${now.getTime()}:${randomUUID()}`,
      name: "BOT_RATE_USAGE",
      source: "BOT_RUNTIME",
      occurredAt: now,
      payload: JSON.stringify({ visitorHash: hash }),
      isTest: true,
    },
  });

  return { fiveMinuteCount: fiveMinuteCount + 1, hourlyCount: hourlyCount + 1 };
}

export interface ProviderBudgetStatus {
  calls: number;
  estimatedCostUsd: number;
  unknownCostCalls: number;
  maxCalls: number;
  maxCostUsd: number | null;
}

export async function assertConversationProviderBudget(shopDomain: string, conversationId: string): Promise<ProviderBudgetStatus> {
  const shop = await ensureBotShop(shopDomain);
  const maxCalls = Math.max(1, Math.min(200, Number(process.env.BOT_MAX_PROVIDER_CALLS_PER_CONVERSATION || 30)));
  const configuredCost = Number(process.env.BOT_MAX_ESTIMATED_COST_USD_PER_CONVERSATION || "");
  const maxCostUsd = Number.isFinite(configuredCost) && configuredCost > 0 ? configuredCost : null;

  const rows = await prisma.event.findMany({
    where: {
      shopId: shop.id,
      name: "bot_model_response",
      eventKey: { startsWith: `bot:event:${conversationId}:` },
    },
    select: { payload: true },
  });

  let estimatedCostUsd = 0;
  let unknownCostCalls = 0;
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload) as { estimatedCostUsd?: number | null };
      if (payload.estimatedCostUsd == null || !Number.isFinite(Number(payload.estimatedCostUsd))) unknownCostCalls += 1;
      else estimatedCostUsd += Number(payload.estimatedCostUsd);
    } catch {
      unknownCostCalls += 1;
    }
  }

  const status: ProviderBudgetStatus = {
    calls: rows.length,
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(6)),
    unknownCostCalls,
    maxCalls,
    maxCostUsd,
  };

  if (status.calls >= maxCalls) {
    throw new BotGuardrailError("CONVERSATION_CALL_BUDGET", "Conversation model-call budget reached.");
  }
  if (maxCostUsd != null) {
    if (unknownCostCalls > 0) {
      throw new BotGuardrailError("COST_BUDGET_UNVERIFIABLE", "AI cost budget is enabled but prior call cost is unknown. Configure model pricing before continuing.");
    }
    if (estimatedCostUsd >= maxCostUsd) {
      throw new BotGuardrailError("CONVERSATION_COST_BUDGET", "Conversation AI cost budget reached.");
    }
  }
  return status;
}
