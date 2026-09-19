/**
 * The adaptive page tests: PostHog assigns the variant on the storefront, the
 * page reacts in the browser, and the outcome is read from two places that do
 * not depend on each other — exposures from PostHog, money from Shopify orders
 * (the variant rides on every line item as `_nova_cro_variant`).
 *
 * Everything here is pure so the arithmetic can be tested without either service.
 */

export const VARIANT_LINE_ITEM_PROPERTY = "_nova_cro_variant";
/** The exit-popup offer test rides on the cart, so it lands on the order itself. */
export const POPUP_ORDER_ATTRIBUTE = "nova_popup_variant";
export const POPUP_LINE_ITEM_PROPERTY = "_nova_popup_variant";
export const POPUP_EXPERIMENT = "nova_popup_offer_v1";

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
  addToCartRate: number | null;
  checkoutRate: number | null;
  revenuePerVisitor: number | null;
  averageOrderValue: number | null;
  /** The share of the window's ad spend this variant's visitors account for, in the revenue currency. */
  spendShare: number | null;
  /** Revenue over that spend share; an estimate, since spend is only known per day, not per visitor. */
  roas: number | null;
  revenuePerVisitorUpliftPercent: number | null;
}

export interface AdaptiveResults {
  currency: string | null;
  mixedCurrencies: boolean;
  variants: VariantResult[];
  totals: { visitors: number; orders: number; revenue: number; unattributedOrders: number; spend: number | null };
  spend: { amount: number; currency: string; note: string } | null;
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
export function variantFromLineItems(lineItems: Array<{ customAttributes?: Array<{ key: string; value: string | null }> }>, property = VARIANT_LINE_ITEM_PROPERTY): string | null {
  for (const item of lineItems) {
    for (const attribute of item.customAttributes || []) {
      if (attribute.key === property && attribute.value) return attribute.value;
    }
  }
  return null;
}

export interface OrderLike {
  customAttributes?: Array<{ key: string; value: string | null }>;
  lineItems: { nodes: Array<{ customAttributes?: Array<{ key: string; value: string | null }> }> };
}

/**
 * The variant an order was placed under, for one experiment.
 *
 * The page test tags every line item; the popup test tags the cart, which
 * Shopify keeps as the order's own attributes, and falls back to a line item
 * property in case a theme copies attributes onto lines.
 */
export function variantFromOrder(order: OrderLike, experimentKey: string): string | null {
  if (experimentKey === POPUP_EXPERIMENT) {
    const own = (order.customAttributes || []).find(attribute => attribute.key === POPUP_ORDER_ATTRIBUTE && attribute.value);
    return own?.value || variantFromLineItems(order.lineItems.nodes, POPUP_LINE_ITEM_PROPERTY);
  }
  return variantFromLineItems(order.lineItems.nodes);
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
  /** Which variant is the baseline; "control" unless the test names its own. */
  controlKey?: string;
  /** Ad spend for the same window, already in the revenue currency, or null when unknown. */
  spend?: { amount: number; currency: string; note: string } | null;
}): AdaptiveResults {
  const paid = input.orders.filter(order => !order.cancelled && order.amount > 0);
  const currencies = new Set(paid.map(order => order.currency));
  const currency = currencies.size === 1 ? [...currencies][0] : null;
  const mixedCurrencies = currencies.size > 1;
  const knownKeys = new Set(input.variants.map(variant => variant.key));
  const unattributedOrders = paid.filter(order => !order.variant || !knownKeys.has(order.variant)).length;
  const controlKey = input.controlKey || "control";
  const totalVisitors = input.exposures.reduce((sum, row) => sum + (row.visitors || 0), 0);
  // Spend is only known per day, so a variant's share of it follows its share of visitors.
  const spend = input.spend && (!currency || input.spend.currency === currency) ? input.spend : null;

  const rows = input.variants.map(variant => {
    const exposure = input.exposures.find(row => row.variant === variant.key);
    const visitors = exposure?.visitors ?? 0;
    const addToCart = exposure?.addToCart ?? 0;
    const checkout = exposure?.checkout ?? 0;
    const variantOrders = new Map(paid.filter(order => order.variant === variant.key).map(order => [order.orderId, order]));
    const orders = variantOrders.size;
    const revenue = Number([...variantOrders.values()].reduce((sum, order) => sum + order.amount, 0).toFixed(2));
    const spendShare = spend && totalVisitors > 0 && visitors > 0 ? Number((spend.amount * visitors / totalVisitors).toFixed(2)) : null;
    return {
      key: variant.key,
      name: variant.name || variant.key,
      percentage: variant.percentage,
      isControl: variant.key === controlKey,
      visitors,
      addToCart,
      checkout,
      orders,
      revenue,
      conversionRate: ratio(orders, visitors),
      addToCartRate: ratio(addToCart, visitors),
      checkoutRate: ratio(checkout, visitors),
      revenuePerVisitor: visitors > 0 ? Number((revenue / visitors).toFixed(2)) : null,
      averageOrderValue: orders > 0 ? Number((revenue / orders).toFixed(2)) : null,
      spendShare,
      roas: spendShare && spendShare > 0 ? Number((revenue / spendShare).toFixed(2)) : null,
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
    spend: spend ? spend.amount : null,
  };
  const enoughData = rows.length > 1 && rows.every(row => row.visitors >= 100 && row.orders >= 10);
  const note = !totals.visitors
    ? "No exposures yet. A visitor counts once PostHog has assigned them a variant."
    : enoughData
      ? "Every variant has at least 100 visitors and 10 orders. Judge on revenue per visitor first."
      : "Too early to call. Read the numbers as direction only until each variant has 100+ visitors and 10+ orders.";
  return { currency, mixedCurrencies, variants: rows, totals, spend, enoughData, note };
}
