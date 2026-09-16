import { supportD1 } from "./support-d1.js";

/**
 * Batched relation loaders for the support desk.
 *
 * Prisma expands a nested `take` (e.g. `messages: { take: 1 }`) into one
 * subquery per parent row joined with UNION ALL, so 40 conversations became
 * ~120 bound parameters and D1 rejected the whole statement with
 * "too many SQL variables" — which is what broke the support inbox list.
 * These loaders ask the same questions with one window query per batch, so the
 * parameter count is the batch size and never the row count times three.
 */
const MAX_BINDS = 80;

function batches<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += MAX_BINDS) out.push(items.slice(index, index + MAX_BINDS));
  return out;
}

function placeholders(count: number): string {
  return new Array(count).fill("?").join(",");
}

/** The newest row of `table` for each conversation id, as a map of id → row. */
export async function latestPerConversation<T = Record<string, unknown>>(
  table: "SupportMessage" | "SupportDraft",
  orderColumn: "sentAt" | "createdAt",
  conversationIds: string[],
): Promise<Map<string, T>> {
  const found = new Map<string, T>();
  if (!conversationIds.length) return found;
  const db = supportD1();
  for (const batch of batches(conversationIds)) {
    const result = await db.prepare(`SELECT * FROM (
        SELECT t.*, ROW_NUMBER() OVER (PARTITION BY t."conversationId" ORDER BY t."${orderColumn}" DESC) AS "__rn"
        FROM "${table}" t WHERE t."conversationId" IN (${placeholders(batch.length)})
      ) WHERE "__rn" = 1`).bind(...batch).all<Record<string, unknown>>();
    for (const row of result.results || []) {
      const { __rn, ...rest } = row;
      found.set(String(row.conversationId), rest as T);
    }
  }
  return found;
}

/** Every matching row of `table` per conversation id, oldest first. */
export async function allPerConversation<T = Record<string, unknown>>(
  table: "SupportMessage" | "SupportDraft" | "SupportEvidenceEvent",
  orderColumn: "sentAt" | "createdAt" | "occurredAt",
  conversationIds: string[],
  filter: { since?: string; kind?: string } = {},
): Promise<Map<string, T[]>> {
  const found = new Map<string, T[]>();
  if (!conversationIds.length) return found;
  const db = supportD1();
  for (const batch of batches(conversationIds)) {
    const clauses = [`t."conversationId" IN (${placeholders(batch.length)})`];
    const binds: unknown[] = [...batch];
    if (filter.since) { clauses.push(`t."${orderColumn}" >= ?`); binds.push(filter.since); }
    if (filter.kind) { clauses.push(`t."kind" = ?`); binds.push(filter.kind); }
    const result = await db.prepare(
      `SELECT t.* FROM "${table}" t WHERE ${clauses.join(" AND ")} ORDER BY t."${orderColumn}" ASC`,
    ).bind(...binds).all<Record<string, unknown>>();
    for (const row of result.results || []) {
      const key = String(row.conversationId);
      const list = found.get(key);
      if (list) list.push(row as T); else found.set(key, [row as T]);
    }
  }
  return found;
}

/**
 * Adds the newest message and newest draft to each conversation row, in the
 * `messages` / `drafts` array shape the inbox and the mail agent already read.
 */
export async function withLatestMessageAndDraft<T extends { id: string }>(rows: T[]): Promise<Array<T & { messages: unknown[]; drafts: unknown[] }>> {
  const ids = rows.map(row => row.id);
  const [messages, drafts] = await Promise.all([
    latestPerConversation("SupportMessage", "sentAt", ids),
    latestPerConversation("SupportDraft", "createdAt", ids),
  ]);
  return rows.map(row => {
    const message = messages.get(row.id);
    const draft = drafts.get(row.id);
    return { ...row, messages: message ? [message] : [], drafts: draft ? [draft] : [] };
  });
}
