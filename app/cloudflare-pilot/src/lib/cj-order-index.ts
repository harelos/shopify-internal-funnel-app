import { isCancelledCjRow, isPurchaseRow, shopifyOrderNumberOf, type CjOrderListRow } from "./cj-cost-match.js";

export interface CjOrderIndex {
  rows: CjOrderListRow[];
  /** True only when every CJ order created since `since` was read. */
  complete: boolean;
  pages: number;
  oldestCreateDate: string | null;
}

/** CJ timestamps are "YYYY-MM-DD HH:mm:ss" in UTC. */
export function cjTimestampToIso(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = new Date(/[TZ]/.test(text) ? text : `${text.replace(" ", "T")}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Reads CJ's order list until it reaches back past `since`, or fails.
 *
 * The missing-order sweep used to stop at the first failed page and treat
 * whatever it had read as the whole of CJ. A timeout on page two made six
 * shipped orders look absent, and six duplicate orders were placed for
 * parcels already in the post. Here a failed page is an error, and a list
 * cut off before reaching `since` is reported as incomplete, so a caller can
 * refuse to act rather than act on half a list. CJ lists newest first; if the
 * rows ever arrive in another order, only an exhausted list counts.
 */
export async function readCjOrderIndex(input: {
  list: (pageNum: number, pageSize: number) => Promise<CjOrderListRow[]>;
  /** ISO instant; every order created at or after it must be in the result. */
  since: string;
  maxPages?: number;
  pageSize?: number;
}): Promise<CjOrderIndex> {
  const pageSize = Math.max(1, Math.min(100, input.pageSize ?? 100));
  const maxPages = Math.max(1, input.maxPages ?? 10);
  const sinceMs = new Date(input.since).getTime();
  if (!Number.isFinite(sinceMs)) throw new Error("readCjOrderIndex needs a valid `since` instant.");

  const rows: CjOrderListRow[] = [];
  let pages = 0;
  let complete = false;
  let oldest: number | null = null;
  let previous: number | null = null;
  let descending = true;

  for (let page = 1; page <= maxPages; page += 1) {
    const current = await input.list(page, pageSize);
    pages += 1;
    rows.push(...current);
    for (const row of current) {
      const iso = cjTimestampToIso(row?.createDate);
      const at = iso ? new Date(iso).getTime() : null;
      if (at == null) { descending = false; continue; }
      if (previous != null && at > previous) descending = false;
      previous = at;
      if (oldest == null || at < oldest) oldest = at;
    }
    if (current.length < pageSize) { complete = true; break; }
    if (descending && oldest != null && oldest < sinceMs) { complete = true; break; }
  }

  return { rows, complete, pages, oldestCreateDate: oldest == null ? null : new Date(oldest).toISOString() };
}

/**
 * The CJ orders actually purchased, grouped by Shopify order number.
 *
 * A store shadow ("#4470") is the connection seeing the sale, not an order;
 * a cancelled or trashed row is not one either. Everything else filed under
 * a purchase prefix — AUTO-, RESCUE-, MANUAL-, BACKFILL- — is a real order,
 * whichever system placed it, and two of them for one sale is a duplicate.
 */
export function purchasedCjOrdersByNumber(rows: CjOrderListRow[]): Map<string, CjOrderListRow[]> {
  const byNumber = new Map<string, CjOrderListRow[]>();
  for (const row of rows) {
    if (!row?.orderId || !isPurchaseRow(row) || isCancelledCjRow(row)) continue;
    const number = shopifyOrderNumberOf(row);
    if (!number) continue;
    const list = byNumber.get(number) ?? [];
    list.push(row);
    byNumber.set(number, list);
  }
  return byNumber;
}
