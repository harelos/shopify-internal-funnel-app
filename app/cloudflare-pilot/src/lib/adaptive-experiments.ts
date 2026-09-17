/**
 * The adaptive page tests: PostHog assigns the variant on the storefront, the
 * page reacts in the browser, and the outcome is read from two places that do
 * not depend on each other — exposures from PostHog, money from Shopify orders
 * (the variant rides on every line item as `_nova_cro_variant`).
 *
 * Everything here is pure so the arithmetic can be tested without either service.
 */

export const VARIANT_LINE_ITEM_PROPERTY = "_nova_cro_variant";

export interface AllocationInput {
  key: string;
  percentage: number;
}

export interface ExposureRow {
  variant: string;
  visitors: number;
  addToCart: number;
  checkout: number;
}

export interface OrderRow {
  orderId: string;
  variant: string | null;
  amount: number;
  currency: string;
  cancelled: boolean;
}

export interface VariantResult {
  key: string;
  name: string;
  percentage: number;
  isControl: boolean;
  visitors: number;
  addToCart: number;
  checkout: number;
  orders: number;
  revenue: number;
  conversionRate: number | null;
  revenuePerVisitor: number | null;
  averageOrderValue: number | null;
  revenuePerVisitorUpliftPercent: number | null;
}

export interface AdaptiveResults {
  currency: string | null;
  mixedCurrencies: boolean;
  variants: VariantResult[];
  totals: { visitors: number; orders: number; revenue: number; unattributedOrders: number };
  enoughData: boolean;
  note: string;
}

/** Whole percentages that add to exactly 100, in the order the flag lists them. */
export function normalizeAllocations(input: unknown, knownKeys: string[]): AllocationInput[] {
  if (!Array.isArray(input) || !input.length) throw new Error("Send one percentage per variant.");
  const seen = new Set<string>();
  const rows = input.map(item => {
    const key = String((item as { key?: unknown })?.key ?? "").trim();
    const percentage = Number((item as { percentage?: unknown })?.percentage);
    if (!knownKeys.includes(key)) throw new Error(`Unknown variant "${key}".`);
    if (seen.has(key)) throw new Error(`Variant "${key}" is listed twice.`);
    if (!Number.isInteger(percentage) || percentage < 0 || percentage > 100) throw new Error(`"${key}" needs a whole number between 0 and 100.`);
    seen.add(key);
    return { key, percentage };
  });
  for (const key of knownKeys) if (!seen.has(key)) throw new Error(`Variant "${key}" is missing.`);
  const total = rows.reduce((sum, row) => sum + row.percentage, 0);
  if (total !== 100) throw new Error(`Percentages add up to ${total}, they must add up to 100.`);
  return knownKeys.map(key => rows.find(row => row.key === key)!);
}

/** The variant an order was placed under, read from its line item properties. */
export function variantFromLineItems(lineItems: Array<{ customAttributes?: Array<{ key: string; value: string | null }> }>): string | null {
  for (const item of lineItems) {
    for (const attribute of item.customAttributes || []) {
      if (attribute.key === VARIANT_LINE_ITEM_PROPERTY && attribute.value) return attribute.value;
    }
  }
  return null;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null;
}

function uplift(value: number | null, control: number | null): number | null {
  if (value === null || control === null || control === 0) return null;
  return Number((((value - control) / control) * 100).toFixed(1));
}

export function buildAdaptiveResults(input: {
  variants: Array<{ key: string; name?: string; percentage: number }>;
  exposures: ExposureRow[];
  orders: OrderRow[];
}): AdaptiveResults {
  const paid = input.orders.filter(order => !order.cancelled && order.amount > 0);
  const currencies = new Set(paid.map(order => order.currency));
  const currency = currencies.size === 1 ? [...currencies][0] : null;
  const mixedCurrencies = currencies.size > 1;
  const knownKeys = new Set(input.variants.map(variant => variant.key));
  const unattributedOrders = paid.filter(order => !order.variant || !knownKeys.has(order.variant)).length;

  const rows = input.variants.map(variant => {
    const exposure = input.exposures.find(row => row.variant === variant.key);
    const visitors = exposure?.visitors ?? 0;
    const variantOrders = new Map(paid.filter(order => order.variant === variant.key).map(order => [order.orderId, order]));
    const orders = variantOrders.size;
    const revenue = Number([...variantOrders.values()].reduce((sum, order) => sum + order.amount, 0).toFixed(2));
    return {
      key: variant.key,
      name: variant.name || variant.key,
      percentage: variant.percentage,
      isControl: variant.key === "control",
      visitors,
      addToCart: exposure?.addToCart ?? 0,
      checkout: exposure?.checkout ?? 0,
      orders,
      revenue,
      conversionRate: ratio(orders, visitors),
      revenuePerVisitor: visitors > 0 ? Number((revenue / visitors).toFixed(2)) : null,
      averageOrderValue: orders > 0 ? Number((revenue / orders).toFixed(2)) : null,
      revenuePerVisitorUpliftPercent: null as number | null,
    };
  });
  const control = rows.find(row => row.isControl) || rows[0];
  for (const row of rows) {
    row.revenuePerVisitorUpliftPercent = row === control ? 0 : uplift(row.revenuePerVisitor, control?.revenuePerVisitor ?? null);
  }

  const totals = {
    visitors: rows.reduce((sum, row) => sum + row.visitors, 0),
    orders: rows.reduce((sum, row) => sum + row.orders, 0),
    revenue: Number(rows.reduce((sum, row) => sum + row.revenue, 0).toFixed(2)),
    unattributedOrders,
  };
  const enoughData = rows.length > 1 && rows.every(row => row.visitors >= 100 && row.orders >= 10);
  const note = !totals.visitors
    ? "No exposures yet. A visitor counts once PostHog has assigned them a variant."
    : enoughData
      ? "Every variant has at least 100 visitors and 10 orders. Judge on revenue per visitor first."
      : "Too early to call. Read the numbers as direction only until each variant has 100+ visitors and 10+ orders.";
  return { currency, mixedCurrencies, variants: rows, totals, enoughData, note };
}
