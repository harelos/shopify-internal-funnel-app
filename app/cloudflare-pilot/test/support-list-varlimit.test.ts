import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desk = readFileSync(path.join(root, "src/routes/support-desk.ts"), "utf8");
const relations = readFileSync(path.join(root, "src/lib/support-relations.ts"), "utf8");

/**
 * Prisma turns a nested `take` into one subquery per parent row joined with
 * UNION ALL. At 40 conversations that is ~120 bound parameters, past D1's
 * per-statement limit, and the inbox died with "too many SQL variables at
 * offset 671". Capping the page size only moved the cliff; the fix is to stop
 * generating per-row subqueries at all.
 */
test("no conversation list loads relations with a per-row nested take", () => {
  const listRoutes = [
    desk.slice(desk.indexOf('supportBridgeRouter.get("/conversations"')),
    desk.slice(desk.indexOf('supportAdminRouter.get("/support/conversations"')),
  ];
  for (const route of listRoutes) {
    const head = route.slice(0, 900);
    assert.doesNotMatch(head, /messages:\s*\{[^}]*take:/, "a conversation list still loads messages with a nested take");
    assert.doesNotMatch(head, /drafts:\s*\{[^}]*take:/, "a conversation list still loads drafts with a nested take");
    assert.match(head, /withLatestMessageAndDraft\(rows\)/, "a conversation list does not use the batched loader");
  }
});

test("the analytics window loads its relations in batches, not per conversation", () => {
  const analytics = desk.slice(desk.indexOf('supportAdminRouter.get("/support/analytics"'));
  const head = analytics.slice(0, 2400);
  assert.doesNotMatch(head, /messages:\s*\{\s*orderBy[^}]*take:\s*100/, "analytics still loads 100 messages per conversation inline");
  for (const table of ["SupportMessage", "SupportDraft", "SupportEvidenceEvent"]) {
    assert.ok(head.includes(`"${table}"`), `analytics does not batch-load ${table}`);
  }
  // Dates come back from raw D1 as ISO text; the scoring maths needs real Dates.
  assert.match(head, /sentAt: new Date\(message\.sentAt\)/);
});

test("the batched loader never binds more parameters than D1 accepts", () => {
  const max = Number(/const MAX_BINDS = (\d+)/.exec(relations)?.[1]);
  assert.ok(Number.isFinite(max) && max > 0 && max <= 90, `batch size ${max} is not safely under D1's 100-parameter limit`);
  // One extra bind is added for `since` and one for `kind`; the batch plus
  // those must still fit.
  assert.ok(max + 2 <= 100, "a filtered batch can still exceed the limit");
  assert.match(relations, /ROW_NUMBER\(\) OVER \(PARTITION BY/, "the latest-row loader is not a single window query");
});
