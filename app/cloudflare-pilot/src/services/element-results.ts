export interface ResultsVariant {
  id: string;
  key: string;
  name: string;
  isControl: boolean;
}

export interface ResultsExposure {
  visitorId: string;
  variantId: string;
  isInternal: boolean;
}

export interface ResultsCheckout {
  checkoutToken: string;
  visitorId: string;
  variantId: string;
}

export interface ResultsOrder {
  orderId: string;
  variantId: string;
  currency: string;
  netRevenueAmount: number;
  isTest: boolean;
  status: string;
}

function percentage(numerator: number, denominator: number): number {
  return denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(2)) : 0;
}

function uplift(value: number | null, baseline: number | null): number | null {
  if (value === null || baseline === null || baseline <= 0) return null;
  return Number((((value - baseline) / baseline) * 100).toFixed(2));
}

export function buildElementExperimentResults(input: {
  variants: ResultsVariant[];
  exposures: ResultsExposure[];
  checkouts: ResultsCheckout[];
  orders: ResultsOrder[];
}) {
  const reportableExposures = input.exposures.filter(exposure => !exposure.isInternal);
  const reportableOrders = input.orders.filter(order => !order.isTest && order.netRevenueAmount > 0 && order.status !== "REFUNDED_OR_CANCELLED");
  const currencies = [...new Set(reportableOrders.map(order => order.currency))].sort();
  const singleCurrency = currencies.length === 1 ? currencies[0] : null;
  const controlId = input.variants.find(variant => variant.isControl)?.id;

  const rows = input.variants.map(variant => {
    const exposedVisitors = new Set(reportableExposures.filter(item => item.variantId === variant.id).map(item => item.visitorId)).size;
    const variantCheckouts = input.checkouts.filter(item => item.variantId === variant.id);
    const checkouts = new Set(variantCheckouts.map(item => item.checkoutToken)).size;
    const checkoutVisitors = new Set(variantCheckouts.map(item => item.visitorId)).size;
    const orders = reportableOrders.filter(item => item.variantId === variant.id);
    const uniqueOrders = new Map(orders.map(order => [order.orderId, order]));
    const revenueByCurrency = [...uniqueOrders.values()].reduce<Record<string, number>>((totals, order) => {
      totals[order.currency] = Number(((totals[order.currency] ?? 0) + order.netRevenueAmount).toFixed(2));
      return totals;
    }, {});
    const orderCount = uniqueOrders.size;
    const revenue = singleCurrency ? revenueByCurrency[singleCurrency] ?? 0 : null;
    return {
      variantId: variant.id,
      variantKey: variant.key,
      variantName: variant.name,
      isControl: variant.isControl,
      exposedVisitors,
      checkouts,
      checkoutVisitors,
      orders: orderCount,
      conversionRate: percentage(orderCount, exposedVisitors),
      checkoutRate: percentage(checkoutVisitors, exposedVisitors),
      revenue,
      revenueByCurrency,
      revenuePerVisitor: revenue === null || exposedVisitors === 0 ? null : Number((revenue / exposedVisitors).toFixed(2)),
      averageOrderValue: revenue === null || orderCount === 0 ? null : Number((revenue / orderCount).toFixed(2)),
    };
  });

  const control = rows.find(row => row.variantId === controlId);
  const variants = rows.map(row => ({
    ...row,
    conversionUpliftPercent: row.isControl ? 0 : uplift(row.conversionRate, control?.conversionRate ?? null),
    revenuePerVisitorUpliftPercent: row.isControl ? 0 : uplift(row.revenuePerVisitor, control?.revenuePerVisitor ?? null),
  }));
  const enoughData = variants.length > 1 && variants.every(row => row.exposedVisitors >= 100 && row.orders >= 10);
  const hasData = variants.some(row => row.exposedVisitors > 0);

  return {
    currency: singleCurrency,
    currencies,
    mixedCurrencies: currencies.length > 1,
    dataStatus: !hasData ? "NO_DATA" : enoughData ? "DIRECTIONAL" : "COLLECTING",
    note: enoughData
      ? "Directional comparison available. Use the configured experiment statistics before declaring a winner."
      : "Keep collecting data. No winner should be declared from this sample yet.",
    variants,
  };
}
