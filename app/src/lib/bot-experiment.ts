import { createHash } from "node:crypto";
import prisma from "./db.js";
import { ensureBotShop } from "./bot-runtime-store.js";
import { assignModelVariant, type ModelVariant } from "./bot-sales-brain.js";

export interface PersistedBotModelAssignment {
  conversationId: string;
  provider: string;
  model: string;
  variantId: string;
  configFingerprint: string;
  assignedAt: string;
  reassignedFrom?: { provider: string; model: string } | null;
}

function fingerprint(variants: ModelVariant[]): string {
  return createHash("sha256")
    .update(variants.map(item => `${item.id}|${item.provider}|${item.model}|${item.trafficBasisPoints}`).join("\n"))
    .digest("hex")
    .slice(0, 16);
}

function parseAssignment(payload: string): PersistedBotModelAssignment | null {
  try {
    const value = JSON.parse(payload) as PersistedBotModelAssignment;
    if (!value || !value.conversationId || !value.provider || !value.model || !value.variantId) return null;
    return value;
  } catch {
    return null;
  }
}

export function chooseConversationModel(
  visitorKey: string,
  variants: ModelVariant[],
  stored?: PersistedBotModelAssignment | null,
): { variant: ModelVariant; assignmentChanged: boolean; previous?: PersistedBotModelAssignment | null } {
  if (stored) {
    const stillEnabled = variants.find(item => item.provider === stored.provider && item.model === stored.model);
    if (stillEnabled) return { variant: stillEnabled, assignmentChanged: false, previous: stored };
  }
  const variant = assignModelVariant(visitorKey, variants);
  return { variant, assignmentChanged: Boolean(stored), previous: stored || null };
}

export async function loadConversationModelAssignment(shopDomain: string, conversationId: string): Promise<PersistedBotModelAssignment | null> {
  const shop = await ensureBotShop(shopDomain);
  const row = await prisma.event.findUnique({
    where: { eventKey: `bot:model-assignment:${shop.id}:${conversationId}` },
    select: { payload: true },
  });
  return row ? parseAssignment(row.payload) : null;
}

export async function resolveConversationModelAssignment(
  shopDomain: string,
  conversationId: string,
  visitorKey: string,
  variants: ModelVariant[],
): Promise<{ variant: ModelVariant; assignment: PersistedBotModelAssignment; assignmentChanged: boolean }> {
  const shop = await ensureBotShop(shopDomain);
  const eventKey = `bot:model-assignment:${shop.id}:${conversationId}`;
  const existing = await prisma.event.findUnique({ where: { eventKey }, select: { payload: true } });
  const stored = existing ? parseAssignment(existing.payload) : null;
  const chosen = chooseConversationModel(visitorKey, variants, stored);
  const now = new Date();
  const assignment: PersistedBotModelAssignment = {
    conversationId,
    provider: chosen.variant.provider,
    model: chosen.variant.model,
    variantId: chosen.variant.id,
    configFingerprint: fingerprint(variants),
    assignedAt: stored && !chosen.assignmentChanged ? stored.assignedAt : now.toISOString(),
    reassignedFrom: chosen.assignmentChanged && stored ? { provider: stored.provider, model: stored.model } : stored?.reassignedFrom || null,
  };

  if (!stored || chosen.assignmentChanged) {
    await prisma.event.upsert({
      where: { eventKey },
      create: {
        shopId: shop.id,
        eventKey,
        name: "BOT_MODEL_ASSIGNMENT",
        source: "BOT_RUNTIME",
        occurredAt: now,
        payload: JSON.stringify(assignment),
        isTest: true,
      },
      update: {
        occurredAt: now,
        payload: JSON.stringify(assignment),
      },
    });
  }

  return { variant: chosen.variant, assignment, assignmentChanged: chosen.assignmentChanged };
}
