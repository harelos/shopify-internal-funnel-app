export type FinancialQuality = "ACTUAL" | "ESTIMATE" | "PARTIAL" | "MISSING";

export interface FinancialMetricConversion {
  originalAmount: number;
  originalCurrency: string;
  /** The currency the amount was restated into. */
  quoteCurrency: string;
  rate: number;
  rateDate: string | null;
  rateSource: string;
  rateQuality: FinancialQuality;
}

export interface FinancialMetric {
  amount: number | null;
  currency: string | null;
  quality: FinancialQuality;
  source: string;
  note: string;
  /** Present only when the amount was restated into the reporting currency. */
  conversion?: FinancialMetricConversion;
}

export interface GrowthCockpitProfitInput {
  revenue: FinancialMetric;
  cjCosts: FinancialMetric;
  paymentFees: FinancialMetric;
  metaSpend: FinancialMetric;
  orders: number;
}

export interface GrowthCockpitProfitOutput {
  complete: boolean;
  currency: string | null;
  cm1: number | null;
  cm2: number | null;
  marginPct: number | null;
  breakEvenCpa: number | null;
  breakEvenRoas: number | null;
  poas: number | null;
  blockers: string[];
  /** Quality of the product-cost input the figures were computed on. */
  costQuality?: FinancialQuality;
  /** Whether Shopify payment fees were subtracted from the figures. */
  paymentFeesIncluded?: boolean;
}

export interface FxRateQuote {
  base: string;
  quote: string;
  rate: number | null;
  rateDate: string | null;
  source: string;
  quality: FinancialQuality;
  note: string;
}

const round2 = (value: number): number => Number(value.toFixed(2));

const QUALITY_RANK: Record<FinancialQuality, number> = { ACTUAL: 3, PARTIAL: 2, ESTIMATE: 1, MISSING: 0 };

export function weakerFinancialQuality(left: FinancialQuality, right: FinancialQuality): FinancialQuality {
  return QUALITY_RANK[left] <= QUALITY_RANK[right] ? left : right;
}

/**
 * Restates one metric in the reporting currency.
 *
 * The store bills in its own currency while Meta and CJ report in another, so
 * a blended view only exists once a published rate is applied. The rate, its
 * publication date and its source stay attached to the converted metric, and
 * the result is never reported above the quality of that rate.
 */
export function convertFinancialMetric(
  metric: FinancialMetric,
  reportingCurrency: string | null,
  quote: FxRateQuote | null,
): FinancialMetric {
  if (!reportingCurrency) {
    return {
      ...metric,
      quality: metric.quality === "MISSING" ? "MISSING" : "PARTIAL",
      note: `${metric.note} REPORTING_CURRENCY is not configured.`,
    };
  }
  if (!metric.currency || metric.currency === reportingCurrency || metric.amount == null) {
    return { ...metric, currency: reportingCurrency };
  }
  if (!quote || quote.rate == null) {
    return {
      amount: null,
      currency: reportingCurrency,
      quality: "MISSING",
      source: metric.source,
      note: `${metric.source} returned ${metric.currency}; ${quote?.note || `no published ${metric.currency}/${reportingCurrency} rate is available.`}`,
    };
  }
  return {
    amount: round2(metric.amount * quote.rate),
    currency: reportingCurrency,
    quality: weakerFinancialQuality(metric.quality, quote.quality),
    source: metric.source,
    note: `${metric.note} Converted from ${metric.currency}: ${quote.note}`,
    conversion: {
      originalAmount: metric.amount,
      originalCurrency: metric.currency,
      quoteCurrency: reportingCurrency,
      rate: quote.rate,
      rateDate: quote.rateDate,
      rateSource: quote.source,
      rateQuality: quote.quality,
    },
  };
}

function metricBlocker(label: string, metric: FinancialMetric): string | null {
  if (metric.amount == null || !Number.isFinite(metric.amount)) return `${label} is missing.`;
  if (metric.quality !== "ACTUAL") return `${label} is ${metric.quality.toLowerCase()}, not authoritative.`;
  if (!metric.currency) return `${label} has no reporting currency.`;
  return null;
}

export function missingFinancialMetric(source: string, note: string): FinancialMetric {
  return { amount: null, currency: null, quality: "MISSING", source, note };
}

export function computeGrowthCockpitProfit(input: GrowthCockpitProfitInput): GrowthCockpitProfitOutput {
  const required: Array<[string, FinancialMetric]> = [
    ["Revenue", input.revenue],
    ["CJ costs", input.cjCosts],
    ["Payment fees", input.paymentFees],
    ["Meta spend", input.metaSpend],
  ];
  const blockers = required.map(([label, metric]) => metricBlocker(label, metric)).filter((value): value is string => Boolean(value));
  const currencies = [...new Set(required.map(([, metric]) => metric.currency).filter(Boolean))];
  if (currencies.length > 1) blockers.push("Required sources do not share one reporting currency.");

  if (blockers.length) {
    return {
      complete: false,
      currency: currencies.length === 1 ? currencies[0] : null,
      cm1: null,
      cm2: null,
      marginPct: null,
      breakEvenCpa: null,
      breakEvenRoas: null,
      poas: null,
      blockers,
    };
  }

  const revenue = input.revenue.amount as number;
  const cjCosts = input.cjCosts.amount as number;
  const paymentFees = input.paymentFees.amount as number;
  const metaSpend = input.metaSpend.amount as number;
  const cm1 = revenue - cjCosts - paymentFees;
  const cm2 = cm1 - metaSpend;
  return {
    complete: true,
    currency: currencies[0] ?? null,
    cm1: round2(cm1),
    cm2: round2(cm2),
    marginPct: revenue > 0 ? round2((cm2 / revenue) * 100) : null,
    breakEvenCpa: input.orders > 0 ? round2(cm1 / input.orders) : null,
    breakEvenRoas: cm1 > 0 ? round2(revenue / cm1) : null,
    poas: metaSpend > 0 ? round2(cm1 / metaSpend) : null,
    blockers: [],
  };
}

export function computeGrowthCockpitProfitBeforePaymentFees(
  input: Omit<GrowthCockpitProfitInput, "paymentFees"> & {
    /**
     * Accept an ESTIMATE product cost. CJ charges an order days after Shopify
     * takes payment, so on the day of the sale only the order-amount estimate
     * exists; refusing it left profit and break-even blank for every current
     * window. The output carries costQuality so the figure is never shown as
     * more certain than its weakest input.
     */
    acceptIncompleteCosts?: boolean;
    /**
     * Shopify Payments keeps a percentage of every order, so a profit figure
     * that ignores it overstates what the business actually earned. Fees are
     * subtracted whenever Shopify has returned them; when it has not, the
     * figures are still produced and paymentFeesIncluded says they are not in.
     */
    paymentFees?: FinancialMetric;
  },
): GrowthCockpitProfitOutput {
  const required: Array<[string, FinancialMetric]> = [
    ["Revenue", input.revenue],
    ["Product cost", input.cjCosts],
    ["Meta spend", input.metaSpend],
  ];
  // A measured cost that does not yet cover every sale still beats no profit
  // figure at all, as long as costQuality carries that forward.
  const incompleteCost = Boolean(input.acceptIncompleteCosts)
    && input.cjCosts.quality === "PARTIAL"
    && input.cjCosts.amount != null
    && Number.isFinite(input.cjCosts.amount)
    && Boolean(input.cjCosts.currency);
  const blockers = required
    .map(([label, metric]) => (incompleteCost && metric === input.cjCosts ? null : metricBlocker(label, metric)))
    .filter((value): value is string => Boolean(value));
  const currencies = [...new Set(required.map(([, metric]) => metric.currency).filter(Boolean))];
  if (currencies.length > 1) blockers.push("Required sources do not share one reporting currency.");
  if (blockers.length) {
    return {
      complete: false,
      currency: currencies.length === 1 ? currencies[0] : null,
      cm1: null,
      cm2: null,
      marginPct: null,
      breakEvenCpa: null,
      breakEvenRoas: null,
      poas: null,
      blockers,
    };
  }
  const revenue = input.revenue.amount as number;
  const cjCosts = input.cjCosts.amount as number;
  const metaSpend = input.metaSpend.amount as number;
  const feeMetric = input.paymentFees;
  const feesUsable = Boolean(feeMetric)
    && feeMetric!.amount != null
    && Number.isFinite(feeMetric!.amount)
    && feeMetric!.quality !== "MISSING"
    && feeMetric!.currency === input.revenue.currency;
  const paymentFees = feesUsable ? (feeMetric!.amount as number) : 0;
  const cm1 = revenue - cjCosts - paymentFees;
  const cm2 = cm1 - metaSpend;
  return {
    complete: true,
    currency: currencies[0] ?? null,
    cm1: round2(cm1),
    cm2: round2(cm2),
    marginPct: revenue > 0 ? round2((cm2 / revenue) * 100) : null,
    breakEvenCpa: input.orders > 0 ? round2(cm1 / input.orders) : null,
    breakEvenRoas: cm1 > 0 ? round2(revenue / cm1) : null,
    poas: metaSpend > 0 ? round2(cm1 / metaSpend) : null,
    blockers: [],
    costQuality: feesUsable
      ? weakerFinancialQuality(input.cjCosts.quality, feeMetric!.quality)
      : input.cjCosts.quality,
    paymentFeesIncluded: feesUsable,
  };
}
