import { randomUUID } from "node:crypto";
import prisma from "./db.js";
import { ensureBotShop } from "./bot-runtime-store.js";
import { loadConversationModelAssignment } from "./bot-experiment.js";

export type BotCommerceOutcomeType = "ATC" | "CHECKOUT" | "PURCHASE";

export interface BotCommerceOutcomeInput {
  conversationId: string;
  type: BotCommerceOutcomeType;
  idempotencyKey?: string;
  revenueIls?: number | null;
  contributionProfitIls?: number | null;
}

function finiteNumber(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return null;
  return Number(number.toFixed(2));
}

export async function recordBotCommerceOutcome(shopDomain: string, input: BotCommerceOutcomeInput) {
  const conversationId = String(input.conversationId || "").trim();
  if (!conversationId) throw new Error("conversationId is required.");
  if (!["ATC", "CHECKOUT", "PURCHASE"].includes(input.type)) throw new Error("Unsupported bot commerce outcome.");

  const assignment = await loadConversationModelAssignment(shopDomain, conversationId);
  if (!assignment) throw new Error("Conversation model assignment was not found.");

  const revenueIls = finiteNumber(input.revenueIls, 0, 10_000_000);
  const contributionProfitIls = finiteNumber(input.contributionProfitIls, -10_000_000, 10_000_000);
  if (input.type === "PURCHASE" && revenueIls == null) throw new Error("Purchase revenueIls is required for experiment attribution.");

  const shop = await ensureBotShop(shopDomain);
  const key = String(input.idempotencyKey || randomUUID()).replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 120);
  if (!key) throw new Error("A valid idempotency key is required.");
  const eventKey = `bot:outcome:${shop.id}:${conversationId}:${key}`;
  const now = new Date();
  const name = input.type === "ATC" ? "bot_atc" : input.type === "CHECKOUT" ? "bot_checkout" : "bot_purchase_attributed";
  const payload = {
    conversationId,
    type: input.type,
    provider: assignment.provider,
    model: assignment.model,
    revenueIls,
    contributionProfitIls,
    idempotencyKey: key,
  };

  const event = await prisma.event.upsert({
    where: { eventKey },
    create: {
      shopId: shop.id,
      eventKey,
      name,
      source: "BOT_SIMULATOR",
      occurredAt: now,
      payload: JSON.stringify(payload),
      isTest: true,
    },
    update: {
      occurredAt: now,
      name,
      payload: JSON.stringify(payload),
    },
  });

  return { eventId: event.id, eventKey, ...payload };
}
