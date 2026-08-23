import { randomUUID } from "node:crypto";
import prisma from "./db.js";
import { ensureBotShop } from "./bot-runtime-store.js";

export type BotCrmFactType = "NAME" | "EMAIL" | "PHONE" | "MARKETING_CONSENT";

export interface BotCrmFact {
  id: string;
  conversationId: string;
  type: BotCrmFactType;
  value: string;
  sourceMessageId: string;
  confidence: "HIGH";
  capturedAt: string;
}

function cleanEmail(value: string): string | null {
  const match = value.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  return match ? match[0].toLowerCase().slice(0, 254) : null;
}

function cleanPhone(value: string): string | null {
  const matches = value.match(/(?:\+?\d[\d\s().-]{7,}\d)/g) || [];
  for (const candidate of matches) {
    const digits = candidate.replace(/\D/g, "");
    if (digits.length >= 9 && digits.length <= 15) return candidate.trim().slice(0, 40);
  }
  return null;
}

function explicitName(value: string): string | null {
  const patterns = [
    /(?:קוראים\s+לי|השם\s+שלי\s+הוא|שמי)\s+([\u0590-\u05FFA-Za-z][\u0590-\u05FFA-Za-z '\-]{1,40})/i,
    /(?:my\s+name\s+is|i['’]?m)\s+([A-Za-z][A-Za-z '\-]{1,40})/i,
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    const name = match?.[1]?.trim().replace(/[,.!?].*$/, "");
    if (name && name.length >= 2) return name.slice(0, 60);
  }
  return null;
}

function explicitMarketingConsent(value: string): string | null {
  const text = value.toLowerCase();
  const yes = ["אני מסכימה לקבל", "אני מסכים לקבל", "אפשר לשלוח לי מבצעים", "i agree to receive marketing", "send me offers"];
  const no = ["אל תשלחו לי פרסומות", "לא רוצה מבצעים", "unsubscribe", "do not send me marketing"];
  if (yes.some(item => text.includes(item))) return "OPTED_IN";
  if (no.some(item => text.includes(item))) return "OPTED_OUT";
  return null;
}

export function extractExplicitCrmFacts(message: string, conversationId: string, sourceMessageId: string): BotCrmFact[] {
  const now = new Date().toISOString();
  const candidates: Array<[BotCrmFactType, string | null]> = [
    ["EMAIL", cleanEmail(message)],
    ["PHONE", cleanPhone(message)],
    ["NAME", explicitName(message)],
    ["MARKETING_CONSENT", explicitMarketingConsent(message)],
  ];
  return candidates
    .filter((item): item is [BotCrmFactType, string] => Boolean(item[1]))
    .map(([type, value]) => ({ id: randomUUID(), conversationId, type, value, sourceMessageId, confidence: "HIGH" as const, capturedAt: now }));
}

export async function persistCrmFacts(shopDomain: string, facts: BotCrmFact[]) {
  if (!facts.length) return [];
  const shop = await ensureBotShop(shopDomain);
  for (const fact of facts) {
    await prisma.event.upsert({
      where: { eventKey: `bot:crm:${shop.id}:${fact.conversationId}:${fact.type}:${fact.value.toLowerCase()}` },
      create: {
        shopId: shop.id,
        eventKey: `bot:crm:${shop.id}:${fact.conversationId}:${fact.type}:${fact.value.toLowerCase()}`,
        name: "BOT_CRM_FACT",
        source: "BOT_RUNTIME",
        occurredAt: new Date(fact.capturedAt),
        payload: JSON.stringify(fact),
        isTest: true,
      },
      update: {
        occurredAt: new Date(fact.capturedAt),
        payload: JSON.stringify(fact),
      },
    });
  }
  return facts;
}

export async function loadConversationCrmFacts(shopDomain: string, conversationId: string): Promise<BotCrmFact[]> {
  const shop = await ensureBotShop(shopDomain);
  const rows = await prisma.event.findMany({
    where: {
      shopId: shop.id,
      name: "BOT_CRM_FACT",
      eventKey: { startsWith: `bot:crm:${shop.id}:${conversationId}:` },
    },
    orderBy: { occurredAt: "asc" },
  });
  return rows.flatMap(row => {
    try { return [JSON.parse(row.payload) as BotCrmFact]; } catch { return []; }
  });
}
