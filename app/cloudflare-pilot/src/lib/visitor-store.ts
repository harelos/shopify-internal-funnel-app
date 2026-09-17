type VisitorRecord = { id: string };
type VisitorDelegate = {
  findUnique(args: unknown): Promise<VisitorRecord | null>;
  create(args: unknown): Promise<VisitorRecord>;
};

/**
 * Prisma's D1 adapter cannot make an upsert atomic because D1 transactions are
 * unavailable. Two analytics requests from the same page can therefore both
 * miss the lookup and race on the composite unique key. The loser re-reads the
 * row created by the winner so neither analytics event is dropped.
 */
export async function findOrCreateVisitorWithStore(
  visitorStore: VisitorDelegate,
  shopId: string,
  anonymousKeyHash: string,
): Promise<VisitorRecord> {
  const where = { shopId_anonymousKeyHash: { shopId, anonymousKeyHash } };
  const existing = await visitorStore.findUnique({ where });
  if (existing) return existing;

  try {
    return await visitorStore.create({ data: { shopId, anonymousKeyHash } });
  } catch (error) {
    const concurrent = await visitorStore.findUnique({ where });
    if (concurrent) return concurrent;
    throw error;
  }
}

export async function findOrCreateVisitor(shopId: string, anonymousKeyHash: string) {
  const { default: prisma } = await import("./db.js");
  return findOrCreateVisitorWithStore(
    prisma.visitor as unknown as VisitorDelegate,
    shopId,
    anonymousKeyHash,
  );
}
