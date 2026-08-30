import { randomUUID, createHash } from "node:crypto";
import prisma from "./db.js";

export interface BotStoredKnowledgePack {
  key: string;
  title: string;
  scope: string;
  scopeId?: string | null;
  text: string;
  priority: number;
  updatedAt: string;
}

export interface BotStoredMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  route?: string | null;
  provider?: string | null;
  model?: string | null;
  latencyMs?: number | null;
  estimatedCostUsd?: number | null;
  occurredAt: string;
}

function cleanDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export async function ensureBotShop(shopDomain: string) {
  const domain = cleanDomain(shopDomain || "local-dev.myshopify.com");
  return prisma.shop.upsert({ where: { domain }, create: { domain }, update: {} });
}

function parsePayload<T>(payload: string, fallback: T): T {
  try {
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === "object" ? parsed as T : fallback;
  } catch {
    return fallback;
  }
}

export function pseudonymousVisitorKey(value: string): string {
  return createHash("sha256").update(value || randomUUID()).digest("hex").slice(0, 32);
}

export async function listKnowledgePacks(shopDomain: string): Promise<BotStoredKnowledgePack[]> {
  const shop = await ensureBotShop(shopDomain);
  const rows = await prisma.event.findMany({
    where: { shopId: shop.id, name: "BOT_KNOWLEDGE_PACK", source: "BOT_ADMIN" },
    orderBy: { occurredAt: "desc" },
  });
  return rows.map(row => parsePayload<BotStoredKnowledgePack>(row.payload, {
    key: row.eventKey,
    title: "Untitled",
    scope: "GLOBAL",
    text: "",
    priority: 0,
    updatedAt: row.occurredAt.toISOString(),
  }));
}

export async function upsertKnowledgePack(shopDomain: string, input: Omit<BotStoredKnowledgePack, "updatedAt">): Promise<BotStoredKnowledgePack> {
  const shop = await ensureBotShop(shopDomain);
  const now = new Date();
  const allowedScopes = new Set(["GLOBAL", "PRODUCT", "FUNNEL", "PAGE_TYPE", "ROLE"]);
  const requestedScope = input.scope.trim().toUpperCase();
  const normalized: BotStoredKnowledgePack = {
    key: input.key.trim().slice(0, 120),
    title: input.title.trim().slice(0, 160),
    scope: allowedScopes.has(requestedScope) ? requestedScope : "GLOBAL",
    scopeId: input.scopeId?.trim().slice(0, 160) || null,
    text: input.text.trim().slice(0, 20_000),
    priority: Math.max(-100, Math.min(100, Math.round(Number(input.priority) || 0))),
    updatedAt: now.toISOString(),
  };
  if (!normalized.key || !normalized.title || !normalized.text) throw new Error("Knowledge key, title and text are required.");
  if (normalized.scope !== "GLOBAL" && !normalized.scopeId) throw new Error(`${normalized.scope} knowledge requires a scope ID.`);
  const eventKey = `bot:knowledge:${shop.id}:${normalized.key}`;
  await prisma.event.upsert({
    where: { eventKey },
    create: {
      shopId: shop.id,
      eventKey,
      name: "BOT_KNOWLEDGE_PACK",
      source: "BOT_ADMIN",
      occurredAt: now,
      payload: JSON.stringify(normalized),
      isTest: true,
    },
    update: { occurredAt: now, payload: JSON.stringify(normalized) },
  });
  return normalized;
}

export async function deleteKnowledgePack(shopDomain: string, key: string) {
  const shop = await ensureBotShop(shopDomain);
  const eventKey = `bot:knowledge:${shop.id}:${key}`;
  await prisma.event.deleteMany({ where: { eventKey, shopId: shop.id, name: "BOT_KNOWLEDGE_PACK" } });
}

export async function selectKnowledgePacks(shopDomain: string, context: { funnelId?: string | null; productId?: string | null; pageType?: string | null; role?: string | null }) {
  const packs = await listKnowledgePacks(shopDomain);
  return packs
    .filter(pack => {
      if (pack.scope === "GLOBAL") return true;
      if (pack.scope === "FUNNEL") return Boolean(pack.scopeId && context.funnelId === pack.scopeId);
      if (pack.scope === "PRODUCT") return Boolean(pack.scopeId && context.productId === pack.scopeId);
      if (pack.scope === "PAGE_TYPE") return Boolean(pack.scopeId && String(context.pageType || "").toUpperCase() === String(pack.scopeId).toUpperCase());
      if (pack.scope === "ROLE") return Boolean(pack.scopeId && String(context.role || "").toUpperCase() === String(pack.scopeId).toUpperCase());
      return false;
    })
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 12);
}

export async function startConversation(shopDomain: string, input: Record<string, unknown>) {
  const shop = await ensureBotShop(shopDomain);
  const conversationId = randomUUID();
  const now = new Date();
  await prisma.event.create({
    data: {
      shopId: shop.id,
      eventKey: `bot:conversation:${conversationId}:meta`,
      name: "BOT_CONVERSATION_STARTED",
      source: "BOT_SIMULATOR",
      occurredAt: now,
      payload: JSON.stringify({ conversationId, ...input, startedAt: now.toISOString() }),
      isTest: true,
    },
  });
  return conversationId;
}

export async function appendConversationMessage(shopDomain: string, message: Omit<BotStoredMessage, "id" | "occurredAt">): Promise<BotStoredMessage> {
  const shop = await ensureBotShop(shopDomain);
  const id = randomUUID();
  const now = new Date();
  const stored: BotStoredMessage = { ...message, id, occurredAt: now.toISOString() };
  await prisma.event.create({
    data: {
      shopId: shop.id,
      eventKey: `bot:conversation:${message.conversationId}:message:${now.getTime()}:${id}`,
      name: message.role === "user" ? "BOT_MESSAGE_USER" : message.role === "assistant" ? "BOT_MESSAGE_ASSISTANT" : "BOT_MESSAGE_SYSTEM",
      source: "BOT_SIMULATOR",
      occurredAt: now,
      payload: JSON.stringify(stored),
      isTest: true,
    },
  });
  return stored;
}

export async function loadConversationMessages(shopDomain: string, conversationId: string): Promise<BotStoredMessage[]> {
  const shop = await ensureBotShop(shopDomain);
  const rows = await prisma.event.findMany({
    where: { shopId: shop.id, eventKey: { startsWith: `bot:conversation:${conversationId}:message:` } },
    orderBy: { occurredAt: "asc" },
  });
  return rows.map(row => parsePayload<BotStoredMessage>(row.payload, {
    id: row.id,
    conversationId,
    role: row.name === "BOT_MESSAGE_USER" ? "user" : row.name === "BOT_MESSAGE_ASSISTANT" ? "assistant" : "system",
    content: "",
    occurredAt: row.occurredAt.toISOString(),
  }));
}

export async function recordBotEvent(shopDomain: string, name: string, payload: Record<string, unknown>, conversationId?: string) {
  const shop = await ensureBotShop(shopDomain);
  const id = randomUUID();
  const now = new Date();
  await prisma.event.create({
    data: {
      shopId: shop.id,
      eventKey: `bot:event:${conversationId || "none"}:${now.getTime()}:${id}`,
      name,
      source: "BOT_SIMULATOR",
      occurredAt: now,
      payload: JSON.stringify({ conversationId: conversationId || null, ...payload }),
      isTest: true,
    },
  });
}

export async function botAnalytics(shopDomain: string, since: Date) {
  const shop = await ensureBotShop(shopDomain);
  const rows = await prisma.event.findMany({
    where: {
      shopId: shop.id,
      occurredAt: { gte: since },
      OR: [{ name: { startsWith: "BOT_" } }, { name: { startsWith: "bot_" } }],
    },
    orderBy: { occurredAt: "asc" },
  });

  const counters: Record<string, number> = {};
  const models: Record<string, { conversations: Set<string>; responses: number; latencyTotal: number; latencyCount: number; costUsd: number; unknownCostCalls: number }> = {};
  const conversations = new Set<string>();

  for (const row of rows) {
    counters[row.name] = (counters[row.name] || 0) + 1;
    const payload = parsePayload<Record<string, any>>(row.payload, {});
    const conversationId = String(payload.conversationId || "");
    if (conversationId) conversations.add(conversationId);

    // Model performance is measured once per actual provider response. User and
    // assistant message rows also carry model metadata for provenance but must not
    // be double-counted as inference calls.
    if (row.name !== "bot_model_response") continue;
    const provider = String(payload.provider || "");
    const model = String(payload.model || "");
    if (!provider || !model) continue;
    const key = `${provider}:${model}`;
    models[key] ||= { conversations: new Set(), responses: 0, latencyTotal: 0, latencyCount: 0, costUsd: 0, unknownCostCalls: 0 };
    if (conversationId) models[key].conversations.add(conversationId);
    models[key].responses += 1;
    if (payload.latencyMs != null && Number.isFinite(Number(payload.latencyMs))) {
      models[key].latencyTotal += Number(payload.latencyMs);
      models[key].latencyCount += 1;
    }
    if (payload.estimatedCostUsd == null || !Number.isFinite(Number(payload.estimatedCostUsd))) models[key].unknownCostCalls += 1;
    else models[key].costUsd += Number(payload.estimatedCostUsd);
  }

  return {
    conversations: conversations.size,
    counters,
    models: Object.fromEntries(Object.entries(models).map(([key, value]) => [key, {
      conversations: value.conversations.size,
      responses: value.responses,
      avgLatencyMs: value.latencyCount ? Math.round(value.latencyTotal / value.latencyCount) : null,
      estimatedCostUsd: Number(value.costUsd.toFixed(6)),
      unknownCostCalls: value.unknownCostCalls,
    }])),
  };
}
