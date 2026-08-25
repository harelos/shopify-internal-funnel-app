export type FinancialQuality = "ACTUAL" | "ESTIMATE" | "PARTIAL" | "MISSING";

export interface FinancialMetric {
  amount: number | null;
  currency: string | null;
  quality: FinancialQuality;
  source: string;
  note: string;
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
}

const round2 = (value: number): number => Number(value.toFixed(2));

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
