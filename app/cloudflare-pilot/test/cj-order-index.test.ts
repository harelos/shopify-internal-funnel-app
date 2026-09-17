import assert from "node:assert/strict";
import test from "node:test";
import { cjTimestampToIso, purchasedCjOrdersByNumber, readCjOrderIndex } from "../src/lib/cj-order-index.js";
import type { CjOrderListRow } from "../src/lib/cj-cost-match.js";

const row = (orderNum: string, createDate: string, extra: Partial<CjOrderListRow> = {}): CjOrderListRow =>
  ({ orderId: `id-${orderNum}-${createDate}`, orderNum, orderStatus: "CREATED", createDate, ...extra });
const pagesOf = (rows: CjOrderListRow[], size = 2) => {
  const pages: CjOrderListRow[][] = [];
  for (let index = 0; index < rows.length; index += size) pages.push(rows.slice(index, index + size));
  return pages;
};

test("CJ timestamps are UTC without a zone marker", () => {
  assert.equal(cjTimestampToIso("2026-09-17 11:54:25"), "2026-09-17T11:54:25.000Z");
  assert.equal(cjTimestampToIso(""), null);
  assert.equal(cjTimestampToIso("nonsense"), null);
});

/**
 * On 2026-09-17 a timeout on page two of CJ's list made six shipped orders
 * look absent, and six duplicate orders were placed for them. A failed page
 * is now an error; nothing downstream sees a partial list as the whole of CJ.
 */
test("a failed page fails the read; nothing is returned as if complete", async () => {
  const pages = pagesOf([
    row("AUTO-4486", "2026-09-17 14:11:48"), row("AUTO-4485", "2026-09-17 11:54:35"),
    row("AUTO-4484", "2026-09-17 11:26:39"), row("RESCUE-4414", "2026-09-08 09:00:00"),
  ]);
  const list = async (page: number) => {
    if (page === 2) throw new Error("CJ timed out");
    return pages[page - 1] ?? [];
  };
  await assert.rejects(readCjOrderIndex({ list, since: "2026-09-01T00:00:00Z", pageSize: 2 }), /timed out/);
});

test("a list cut off before reaching `since` is incomplete", async () => {
  const pages = pagesOf([
    row("AUTO-4486", "2026-09-17 14:11:48"), row("AUTO-4485", "2026-09-17 11:54:35"),
    row("AUTO-4484", "2026-09-17 11:26:39"), row("RESCUE-4414", "2026-09-08 09:00:00"),
    row("RESCUE-4400", "2026-09-05 09:00:00"), row("RESCUE-4390", "2026-09-03 09:00:00"),
  ]);
  const list = async (page: number) => pages[page - 1] ?? [];
  const cut = await readCjOrderIndex({ list, since: "2026-09-01T00:00:00Z", pageSize: 2, maxPages: 2 });
  assert.equal(cut.complete, false);
  assert.equal(cut.pages, 2);
  // Reading back past `since` on a newest-first list is enough; the rest is
  // older than the window.
  const enough = await readCjOrderIndex({ list, since: "2026-09-10T00:00:00Z", pageSize: 2, maxPages: 2 });
  assert.equal(enough.complete, true);
  assert.equal(enough.rows.length, 4);
  // A short last page means the list is exhausted, whatever the dates say.
  const all = await readCjOrderIndex({ list, since: "2026-01-01T00:00:00Z", pageSize: 2, maxPages: 10 });
  assert.equal(all.complete, true);
  assert.equal(all.rows.length, 6);
  assert.equal(all.pages, 4);
});

test("rows that are not newest-first are only trusted when the list is exhausted", async () => {
  const shuffled = [row("A-1", "2026-09-10 00:00:00"), row("A-2", "2026-09-17 00:00:00"), row("A-3", "2026-09-01 00:00:00"), row("A-4", "2026-09-16 00:00:00")];
  const pages = pagesOf(shuffled);
  const list = async (page: number) => pages[page - 1] ?? [];
  const partial = await readCjOrderIndex({ list, since: "2026-09-12T00:00:00Z", pageSize: 2, maxPages: 1 });
  assert.equal(partial.complete, false, "the oldest row read is before `since`, but the order of rows proves nothing");
  const exhausted = await readCjOrderIndex({ list, since: "2026-09-12T00:00:00Z", pageSize: 2, maxPages: 5 });
  assert.equal(exhausted.complete, true);
});

test("only purchased, live CJ orders count, grouped by the sale they belong to", () => {
  const rows: CjOrderListRow[] = [
    row("#4470", "2026-09-16 10:00:00"), // the store's shadow: never purchased
    row("AUTO-4470", "2026-09-16 10:01:00"),
    row("RESCUE-4470", "2026-09-16 10:05:00"), // a second writer: the duplicate the audit must see
    row("MANUAL-4471", "2026-09-16 11:00:00"),
    row("AUTO-4472", "2026-09-16 12:00:00", { orderStatus: "TRASH" }),
    row("BACKFILL-4473", "2026-09-16 12:00:00", { orderStatus: "CANCELLED" }),
    { orderNum: "AUTO-4474", createDate: "2026-09-16 12:00:00" }, // no orderId: not an order
  ];
  const byNumber = purchasedCjOrdersByNumber(rows);
  assert.deepEqual([...byNumber.keys()].sort(), ["4470", "4471"]);
  assert.deepEqual(byNumber.get("4470")?.map(item => item.orderNum), ["AUTO-4470", "RESCUE-4470"]);
});
