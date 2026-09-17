import type { CjOrderListRow } from "./cj-cost-match.js";
import { purchasedCjOrdersByNumber } from "./cj-order-index.js";

export interface AuditSale {
  /** Shopify order GID, the ledger row's externalKey. */
  id: string;
  name: string;
  processedAt: string;
}

export interface AuditLedgerRow {
  externalKey: string;
  occurredDate: string;
  amount: number | string | null;
  metadata?: string | null;
}

export interface SupplierCostAuditDay {
  date: string;
  sales: number;
  priced: number;
  amount: number;
}

export interface SupplierCostAudit {
  sales: number;
  priced: number;
  exact: number;
  bundlePriced: number;
  /** Paid sales with no positive cost row. */
  unpriced: Array<{ order: string; saleDate: string }>;
  /** Cost rows dated on a day other than the sale's. */
  misdated: Array<{ order: string; saleDate: string; ledgerDate: string; amount: number }>;
  /** Sales CJ holds more than one purchased order for. */
  duplicatesAtCj: Array<{ order: string; cjOrders: string[] }>;
  days: SupplierCostAuditDay[];
  ok: boolean;
}

export function localDateOf(instant: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant));
}

/**
 * Compares three sources of the same fact — Shopify's paid sales, the cost
 * ledger, CJ's order list — and names every disagreement.
 *
 * The rule the ledger must satisfy is one row per paid sale, dated by the
 * sale, at CJ's price for it. Every earlier fix was checked once by hand and
 * then drifted: rows were re-dated to the day a sweep ran, sales went
 * unpriced, and duplicate CJ orders appeared for parcels already shipped.
 * This is the check that used to be a person's memory.
 */
export function auditSupplierCosts(input: {
  sales: AuditSale[];
  ledgerRows: AuditLedgerRow[];
  /** Null when CJ's list could not be read completely; the duplicate check then does not run. */
  cjRows: CjOrderListRow[] | null;
  timezone: string;
}): SupplierCostAudit {
  const rowsByKey = new Map(input.ledgerRows.map(row => [row.externalKey, row]));
  const days = new Map<string, SupplierCostAuditDay>();
  const unpriced: SupplierCostAudit["unpriced"] = [];
  const misdated: SupplierCostAudit["misdated"] = [];
  let priced = 0;
  let exact = 0;
  let bundlePriced = 0;

  for (const sale of input.sales) {
    const saleDate = localDateOf(sale.processedAt, input.timezone);
    const day = days.get(saleDate) ?? { date: saleDate, sales: 0, priced: 0, amount: 0 };
    day.sales += 1;
    days.set(saleDate, day);
    const row = rowsByKey.get(sale.id);
    const amount = Number(row?.amount);
    if (!row || !(amount > 0)) {
      unpriced.push({ order: sale.name, saleDate });
      continue;
    }
    priced += 1;
    day.priced += 1;
    day.amount += amount;
    let basis = "";
    try { basis = String(JSON.parse(row.metadata || "{}").costBasis || ""); } catch { basis = ""; }
    if (basis === "CJ_BUNDLE_PRICE") bundlePriced += 1;
    else exact += 1;
    if (String(row.occurredDate) !== saleDate) {
      misdated.push({ order: sale.name, saleDate, ledgerDate: String(row.occurredDate), amount });
    }
  }

  const duplicatesAtCj: SupplierCostAudit["duplicatesAtCj"] = [];
  if (input.cjRows) {
    const byNumber = purchasedCjOrdersByNumber(input.cjRows);
    for (const sale of input.sales) {
      const number = String(sale.name || "").trim().replace(/^#/, "");
      const orders = byNumber.get(number) || [];
      if (orders.length > 1) {
        duplicatesAtCj.push({ order: sale.name, cjOrders: orders.map(row => String(row.orderNum || row.orderId)) });
      }
    }
  }

  return {
    sales: input.sales.length,
    priced,
    exact,
    bundlePriced,
    unpriced,
    misdated,
    duplicatesAtCj,
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)).map(day => ({ ...day, amount: Number(day.amount.toFixed(2)) })),
    ok: unpriced.length === 0 && misdated.length === 0 && duplicatesAtCj.length === 0,
  };
}
