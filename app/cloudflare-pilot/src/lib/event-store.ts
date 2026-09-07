type EventRecord = { id: string };
type EventDelegate = {
  findUnique(args: unknown): Promise<EventRecord | null>;
  create(args: unknown): Promise<EventRecord>;
};

export async function createEventOnceWithStore(
  eventStore: EventDelegate,
  eventKey: string,
  data: Record<string, unknown>,
): Promise<{ event: EventRecord; duplicate: boolean }> {
  const where = { eventKey };
  const existing = await eventStore.findUnique({ where });
  if (existing) return { event: existing, duplicate: true };

  try {
    const event = await eventStore.create({ data });
    return { event, duplicate: false };
  } catch (error) {
    const concurrent = await eventStore.findUnique({ where });
    if (concurrent) return { event: concurrent, duplicate: true };
    throw error;
  }
}

export async function createEventOnce(eventKey: string, data: Record<string, unknown>) {
  const { default: prisma } = await import("./db.js");
  return createEventOnceWithStore(
    prisma.event as unknown as EventDelegate,
    eventKey,
    data,
  );
}
