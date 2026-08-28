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
  paidOrderRows: number;
  actualPaymentRows: number;
  orderAmountFallbackRows: number;
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
  const paidOrderRows = rows.filter(row => row?.orderId && row?.isSandbox !== 1).length;
  let actualPaymentRows = 0;
  let orderAmountFallbackRows = 0;
  let detailFailures = 0;
  for (const row of rows) {
    if (!row?.orderId || row?.isSandbox === 1) continue;
    try {
      const detail = await getCjOrderDetail(String(row.orderId));
      const actualPayment = Number(detail?.actualPayment);
      const fallbackOrderAmount = Number(row?.orderAmount);
      const hasActualPayment = Number.isFinite(actualPayment) && actualPayment >= 0;
      const hasFallbackOrderAmount = Number.isFinite(fallbackOrderAmount) && fallbackOrderAmount >= 0;
      const paymentDate = String(detail?.paymentDate || row?.paymentDate || "");
      if ((!hasActualPayment && !hasFallbackOrderAmount) || !paymentDate) {
        detailFailures += 1;
        continue;
      }
      const amount = hasActualPayment ? actualPayment : fallbackOrderAmount;
      if (hasActualPayment) actualPaymentRows += 1;
      else orderAmountFallbackRows += 1;
      entries.push({
        source: "CJ_PAID_ORDERS",
        category: "ACCOUNT_PAID_ORDER_COST",
        externalKey: String(row.orderId),
        occurredDate: cjUtcDate(paymentDate),
        amount,
        currency: "USD",
        quality: hasActualPayment ? "ACTUAL" as const : "ESTIMATE" as const,
        metadata: {
          costBasis: hasActualPayment ? "CJ actualPayment" : "CJ orderAmount on API-confirmed paid order",
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
  return {
    rowsScanned: rows.length,
    paidOrderRows,
    actualPaymentRows,
    orderAmountFallbackRows,
    entriesPersisted,
    detailFailures,
    truncated,
  };
}
