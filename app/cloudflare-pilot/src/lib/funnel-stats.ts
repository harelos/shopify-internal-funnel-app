/**
 * The Funnels page: one funnel, day by day.
 *
 * Every day is one row: visitors, add to cart, checkout, purchases, revenue and
 * the rates between them. Three sources feed a row, and each row says which
 * one it stands on:
 *
 *   first_party        the sales page reports every visitor to the app itself
 *                      (CroAssignment), complete from 18 Sept 2026 for NovaHair;
 *                      no cookie consent involved, so it is the denominator of
 *                      choice whenever it exists for a day
 *   shopify_analytics  what Shopify's own Sessions report says for the landing
 *                      page; seeded from the store's reports because the Worker's
 *                      token cannot run ShopifyQL; used for days before the app
 *                      counted visitors itself
 *   shopify_orders     paid orders whose landing page (or product) belongs to the
 *                      funnel, from the Admin API, cached per day in D1
 *
 * Money always comes from Shopify orders. Visitors and the two on-page steps
 * come from the best available source for that day.
 */

export interface FunnelDefinition {
  key: string;
  name: string;
  path: string;
  /** Line-item product handles that belong to this funnel (null: match by landing page only). */
  productHandles: RegExp | null;
  /** The first-party test whose assignment rows count this page's visitors. */
  firstPartyExperimentKey: string | null;
}

export const FUNNELS: FunnelDefinition[] = [
  { key: "novahair", name: "NovaHair sales page", path: "/pages/novahair-sales-staging", productHandles: /^novahair/i, firstPartyExperimentKey: "nova_adaptive_cro_v2" },
  { key: "oceaura-a", name: "OceAura — version A", path: "/pages/oceaura-sales-staging", productHandles: null, firstPartyExperimentKey: null },
  { key: "oceaura-b", name: "OceAura — version B", path: "/pages/oceaura-sales-staging-b", productHandles: null, firstPartyExperimentKey: null },
];

export function funnelByKey(key: unknown): FunnelDefinition | null {
  const wanted = String(key ?? "").trim().toLowerCase();
  return FUNNELS.find(funnel => funnel.key === wanted) ?? null;
}

export type Basis = "first_party" | "shopify" | "none";

export interface DayInput {
  day: string; // YYYY-MM-DD, Israel calendar day
  shopify?: { sessions: number; addedToCart: number; reachedCheckout: number; purchases: number } | null;
  firstParty?: { visitors: number; addedToCart: number; reachedCheckout: number } | null;
  orders?: { purchases: number; revenue: number } | null;
}

export interface DayRow {
  day: string;
  basis: Basis;
  visitors: number;
  addedToCart: number;
  reachedCheckout: number;
  purchases: number;
  revenue: number;
  /** Shopify's own session count for the day, when known, for comparison. */
  shopifySessions: number | null;
  /** Shopify's own completed-checkout sessions, the fallback when orders are not cached. */
  shopifyPurchases: number | null;
  ordersKnown: boolean;
  rates: Rates;
}

export interface Rates {
  addToCart: number | null;
  checkout: number | null;
  conversion: number | null;
  cartToCheckout: number | null;
  checkoutToPurchase: number | null;
  revenuePerVisitor: number | null;
  averageOrder: number | null;
}

const ratio = (num: number, den: number): number | null => den > 0 ? Number((num / den).toFixed(4)) : null;

export function rates(row: { visitors: number; addedToCart: number; reachedCheckout: number; purchases: number; revenue: number }): Rates {
  return {
    addToCart: ratio(row.addedToCart, row.visitors),
    checkout: ratio(row.reachedCheckout, row.visitors),
    conversion: ratio(row.purchases, row.visitors),
    cartToCheckout: ratio(row.reachedCheckout, row.addedToCart),
    checkoutToPurchase: ratio(row.purchases, row.reachedCheckout),
    revenuePerVisitor: row.visitors > 0 ? Number((row.revenue / row.visitors).toFixed(2)) : null,
    averageOrder: row.purchases > 0 ? Number((row.revenue / row.purchases).toFixed(2)) : null,
  };
}

/** One day from whatever sources exist for it. */
export function composeDay(input: DayInput): DayRow {
  const fp = input.firstParty ?? null;
  const sh = input.shopify ?? null;
  const basis: Basis = fp && fp.visitors > 0 ? "first_party" : sh ? "shopify" : "none";
  const visitors = basis === "first_party" ? fp!.visitors : sh ? sh.sessions : 0;
  const addedToCart = basis === "first_party" ? fp!.addedToCart : sh ? sh.addedToCart : 0;
  const reachedCheckout = basis === "first_party" ? fp!.reachedCheckout : sh ? sh.reachedCheckout : 0;
  const ordersKnown = Boolean(input.orders);
  const purchases = ordersKnown ? input.orders!.purchases : sh ? sh.purchases : 0;
  const revenue = ordersKnown ? Number(input.orders!.revenue.toFixed(2)) : 0;
  const base = { visitors, addedToCart, reachedCheckout, purchases, revenue };
  return {
    day: input.day,
    basis,
    ...base,
    shopifySessions: sh ? sh.sessions : null,
    shopifyPurchases: sh ? sh.purchases : null,
    ordersKnown,
    rates: rates(base),
  };
}

export interface PeriodRow {
  key: string;
  label: string;
  from: string;
  to: string;
  days: DayRow[];
  basis: Basis | "mixed";
  visitors: number;
  addedToCart: number;
  reachedCheckout: number;
  purchases: number;
  revenue: number;
  shopifySessions: number | null;
  rates: Rates;
}

export type Grouping = "day" | "week" | "month";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function isoWeekStart(day: string): string {
  // Monday-start weeks, on the calendar day string itself (no timezone shifts)
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}
function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)}`;
}

export function sumRows(days: DayRow[]) {
  const total = days.reduce((acc, row) => ({
    visitors: acc.visitors + row.visitors,
    addedToCart: acc.addedToCart + row.addedToCart,
    reachedCheckout: acc.reachedCheckout + row.reachedCheckout,
    purchases: acc.purchases + row.purchases,
    revenue: acc.revenue + row.revenue,
    shopifySessions: row.shopifySessions == null ? acc.shopifySessions : (acc.shopifySessions ?? 0) + row.shopifySessions,
  }), { visitors: 0, addedToCart: 0, reachedCheckout: 0, purchases: 0, revenue: 0, shopifySessions: null as number | null });
  total.revenue = Number(total.revenue.toFixed(2));
  const bases = new Set(days.map(row => row.basis).filter(basis => basis !== "none"));
  const basis: Basis | "mixed" = bases.size === 0 ? "none" : bases.size === 1 ? [...bases][0] : "mixed";
  return { ...total, basis, rates: rates(total) };
}

/** Day rows folded into weeks or months, oldest first; "day" returns one period per day. */
export function groupRows(days: DayRow[], grouping: Grouping): PeriodRow[] {
  const buckets = new Map<string, DayRow[]>();
  for (const row of [...days].sort((a, b) => a.day.localeCompare(b.day))) {
    const key = grouping === "day" ? row.day : grouping === "week" ? isoWeekStart(row.day) : row.day.slice(0, 7);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(row);
  }
  return [...buckets.entries()].map(([key, rows]) => {
    const from = rows[0].day, to = rows[rows.length - 1].day;
    const label = grouping === "day" ? dayLabel(key)
      : grouping === "week" ? `Week of ${dayLabel(key).slice(4)}`
        : `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
    return { key, label, from, to, days: rows, ...sumRows(rows) };
  });
}

/** Every calendar day between two YYYY-MM-DD strings, inclusive. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end && out.length < 400) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

const ISRAEL_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" });
/** The Israel calendar day of an instant. */
export function israelDay(instant: Date | string): string {
  return ISRAEL_DAY.format(typeof instant === "string" ? new Date(instant) : instant);
}
export function todayInIsrael(): string { return israelDay(new Date()); }

/** Path of a landing-page URL as Shopify reports it, without origin or query. */
export function landingPath(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, "https://tigerbrandsglobal.com");
    return parsed.pathname.replace(/\/+$/, "") || "/";
  } catch { return null; }
}

/** Does this order belong to the funnel? Landing page first; product handle only where the funnel owns products. */
export function orderBelongsToFunnel(funnel: FunnelDefinition, order: { landingPages: Array<string | null | undefined>; productHandles: Array<string | null | undefined> }): boolean {
  const paths = order.landingPages.map(landingPath).filter(Boolean) as string[];
  if (paths.some(path => path === funnel.path)) return true;
  // Another funnel's page claims the order first: a NovaHair bottle bought from
  // the OceAura page is that page's sale.
  if (paths.some(path => FUNNELS.some(other => other.key !== funnel.key && other.path === path))) return false;
  if (!funnel.productHandles) return false;
  return order.productHandles.some(handle => handle && funnel.productHandles!.test(handle));
}
