import type { FinancialMetric, FinancialQuality } from "./growth-cockpit-finance.js";

export interface MetricComparison {
  current: number | null;
  previous: number | null;
  absoluteChange: number | null;
  percentChange: number | null;
  currency: string | null;
  quality: FinancialQuality;
  note: string;
}

export interface GrowthCockpitMetricDefinition {
  key: string;
  label: string;
  definition: string;
  source: string;
  calculation?: string;
}

const round2 = (value: number): number => Number(value.toFixed(2));

export const GROWTH_COCKPIT_METRIC_DEFINITIONS: GrowthCockpitMetricDefinition[] = [
  {
    key: "revenue",
    label: "Shopify net payments",
    definition: "Money received minus refunds for orders processed in the selected period. It includes collected tax and shipping.",
    source: "Shopify Order.netPaymentSet.shopMoney",
  },
  {
    key: "orders",
    label: "Paid orders",
    definition: "Orders in the selected period with a positive Shopify net payment.",
    source: "Shopify Admin Orders",
  },
  {
    key: "cjCosts",
    label: "CJ variable costs",
    definition: "Product, shipping, and other variable fulfillment costs from a reviewed CJ ledger.",
    source: "CJ cost ledger",
  },
  {
    key: "cjPaidCosts",
    label: "CJ paid order costs",
    definition: "CJ paid-order amounts in the selected window, accepted as the current COGS source by the operator.",
    source: "CJ paid-order API",
  },
  {
    key: "paymentFees",
    label: "Payment fees",
    definition: "Authoritative processor transaction fees for the selected period.",
    source: "Payment transaction source",
  },
  {
    key: "metaSpend",
    label: "Meta spend",
    definition: "Reconciled Meta Ads spend for the selected reporting window and timezone.",
    source: "Meta Ads ledger",
  },
  {
    key: "cm1",
    label: "CM1 before payment fees",
    definition: "Contribution margin before advertising spend and before payment fees.",
    source: "Growth Cockpit financial contract",
    calculation: "Revenue - CJ paid order costs",
  },
  {
    key: "cm2",
    label: "Profit before payment fees",
    definition: "Contribution profit after advertising spend, before payment fees.",
    source: "Growth Cockpit financial contract",
    calculation: "CM1 before payment fees - Meta spend",
  },
  {
    key: "cm2Margin",
    label: "Profit margin before payment fees",
    definition: "Profit before payment fees as a percentage of revenue.",
    source: "Growth Cockpit financial contract",
    calculation: "CM2 / revenue",
  },
];

export function compareGrowthCockpitMetric(current: FinancialMetric, previous: FinancialMetric): MetricComparison {
  const authoritative = current.quality === "ACTUAL"
    && previous.quality === "ACTUAL"
    && current.amount != null
    && previous.amount != null
    && current.currency
    && current.currency === previous.currency;
  if (!authoritative) {
    return {
      current: current.amount,
      previous: previous.amount,
      absoluteChange: null,
      percentChange: null,
      currency: current.currency === previous.currency ? current.currency : null,
      quality: "MISSING",
      note: "Comparison is unavailable until both equivalent periods are authoritative and use one currency.",
    };
  }
  const currentAmount = current.amount as number;
  const previousAmount = previous.amount as number;
  const absoluteChange = round2(currentAmount - previousAmount);
  return {
    current: currentAmount,
    previous: previousAmount,
    absoluteChange,
    percentChange: previousAmount === 0 ? null : round2((absoluteChange / previousAmount) * 100),
    currency: current.currency,
    quality: "ACTUAL",
    note: previousAmount === 0 ? "Previous period is zero, so a percentage change is undefined." : "Equivalent completed-period comparison.",
  };
}
