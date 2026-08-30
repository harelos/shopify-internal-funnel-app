export interface ProfitOsAggregateInput {
  contributionRevenueIls: number | null;
  cjTotalVariableCostIls: number | null;
  paymentFeesIls: number | null;
  metaSpendIls: number | null;
  orders: number;
  additionalVariableCostsIls?: number | null;
}

export interface ProfitOsAggregateOutput {
  cm1: number | null;
  cm2: number | null;
  marginPct: number | null;
  breakEvenCpa: number | null;
  breakEvenRoas: number | null;
  poas: number | null;
  profitComplete: boolean;
}

const round2 = (value: number): number => Number(value.toFixed(2));

export function computeProfitOsAggregate(input: ProfitOsAggregateInput): ProfitOsAggregateOutput {
  const required = [
    input.contributionRevenueIls,
    input.cjTotalVariableCostIls,
    input.paymentFeesIls,
    input.metaSpendIls,
  ];

  if (required.some(value => value == null || !Number.isFinite(value))) {
    return {
      cm1: null,
      cm2: null,
      marginPct: null,
      breakEvenCpa: null,
      breakEvenRoas: null,
      poas: null,
      profitComplete: false,
    };
  }

  const revenue = input.contributionRevenueIls as number;
  const cj = input.cjTotalVariableCostIls as number;
  const fees = input.paymentFeesIls as number;
  const meta = input.metaSpendIls as number;
  const additional = input.additionalVariableCostsIls ?? 0;

  const cm1 = revenue - cj - fees - additional;
  // Aggregate CM2 must subtract ALL scoped Meta spend. Order-level attribution
  // may be shown diagnostically but must never replace this aggregate rule.
  const cm2 = cm1 - meta;

  return {
    cm1: round2(cm1),
    cm2: round2(cm2),
    marginPct: revenue > 0 ? round2((cm2 / revenue) * 100) : null,
    breakEvenCpa: input.orders > 0 ? round2(cm1 / input.orders) : null,
    breakEvenRoas: cm1 > 0 ? round2(revenue / cm1) : null,
    poas: meta > 0 ? round2(cm1 / meta) : null,
    profitComplete: true,
  };
}
