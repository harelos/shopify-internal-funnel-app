import { persistFinancialLedgerEntries } from "../lib/financial-ledger.js";
import { getCjOrderDetail, listCjOrders } from "./novahair-monitor.js";

function cjUtcDate(value: string): string {
  const parsed = new Date(`${value.replace(" ", "T")}Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error("CJ returned an invalid payment date.");
  return parsed.toISOString().slice(0, 10);
}

function cjUtcTimestamp(value: string): string {
  return value.replace("T", " ").replace(/\.\d{3}Z$/, "").replace(/Z$/, "");
}

export async function reconcileCjPaidCosts(input: {
  from: string;
  toExclusive: string;
}): Promise<{
  rowsScanned: number;
  paidOrders: number;
  entriesPersisted: number;
  detailFailures: number;
  truncated: boolean;
}> {
  const from = new Date(input.from);
  const toExclusive = new Date(input.toExclusive);
  if (Number.isNaN(from.getTime()) || Number.isNaN(toExclusive.getTime()) || toExclusive <= from) {
    throw new Error("CJ paid-cost reconciliation requires a valid date range.");
  }
  if (toExclusive.getTime() - from.getTime() > 90 * 86400000) {
    throw new Error("CJ payment-date reconciliation is limited to 90 days. Choose a shorter reporting range.");
  }
  const paymentDateFrom = cjUtcTimestamp(from.toISOString());
  const paymentDateTo = cjUtcTimestamp(new Date(toExclusive.getTime() - 1000).toISOString());
  const rows: any[] = [];
  const maxPages = 20;
  let truncated = false;
  for (let page = 1; page <= maxPages; page += 1) {
    const current = await listCjOrders(page, 100, { paymentDateFrom, paymentDateTo });
    rows.push(...current);
    if (current.length < 100) break;
    if (page === maxPages) truncated = true;
  }

  const entries = [];
  let detailFailures = 0;
  for (const row of rows) {
    if (!row?.orderId || row?.isSandbox === 1) continue;
    try {
      const detail = await getCjOrderDetail(String(row.orderId));
      const amount = Number(detail?.actualPayment);
      const paymentDate = String(detail?.paymentDate || row?.paymentDate || "");
      if (!Number.isFinite(amount) || amount < 0 || !paymentDate) {
        detailFailures += 1;
        continue;
      }
      entries.push({
        source: "CJ_PAID_ORDERS",
        category: "ACCOUNT_PAID_ORDER_COST",
        externalKey: String(row.orderId),
        occurredDate: cjUtcDate(paymentDate),
        amount,
        currency: "USD",
        quality: "ACTUAL" as const,
        metadata: {
          costBasis: "CJ actualPayment",
          scope: "CJ account paid orders; not Shopify-order reconciled",
          paymentDateUtc: paymentDate,
        },
      });
    } catch (error) {
      detailFailures += 1;
      console.warn(`[GROWTH COCKPIT] CJ paid-cost detail read failed: ${String((error as Error)?.message || error).slice(0, 180)}`);
    }
  }
  const entriesPersisted = await persistFinancialLedgerEntries(entries);
  return { rowsScanned: rows.length, paidOrders: entries.length, entriesPersisted, detailFailures, truncated };
}
