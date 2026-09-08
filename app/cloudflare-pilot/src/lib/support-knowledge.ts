import prisma from "./db.js";

export interface ApprovedSupportFact {
  id: string;
  key: string;
  factText: string;
  enabled: boolean;
  position: number;
  revision: number;
  updatedAt: Date;
}

export const DEFAULT_SUPPORT_FACTS = [
  { key: "delivery_time", position: 10, factText: "Delivery is available throughout Israel and normally takes 5–12 business days." },
  { key: "free_shipping", position: 20, factText: "Shipping is free for orders above ILS 199." },
  { key: "novahair_shades", position: 30, factText: "NovaHair currently offers five shades." },
  { key: "novahair_offer", position: 40, factText: "The recommended four-bottle offer is ILS 239." },
  { key: "coloring_kit", position: 50, factText: "Every order includes a coloring kit valued at ILS 79." },
  { key: "guarantee", position: 60, factText: "The store offers a 60-day guarantee; any refund, cancellation or shade-change action still requires human review and verified eligibility." },
] as const;

export async function ensureSupportKnowledgeFacts(shopId: string): Promise<ApprovedSupportFact[]> {
  for (const fact of DEFAULT_SUPPORT_FACTS) {
    await prisma.supportKnowledgeFact.upsert({
      where: { shopId_key: { shopId, key: fact.key } },
      update: {},
      create: { shopId, key: fact.key, factText: fact.factText, position: fact.position },
    });
  }
  return prisma.supportKnowledgeFact.findMany({
    where: { shopId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, key: true, factText: true, enabled: true, position: true, revision: true, updatedAt: true },
  });
}

export async function enabledSupportFactTexts(shopId: string): Promise<string[]> {
  const facts = await ensureSupportKnowledgeFacts(shopId);
  return facts.filter(fact => fact.enabled).map(fact => fact.factText);
}
