import type { FinancialQuality } from "./growth-cockpit-finance.js";

/**
 * The operating health score.
 *
 * Five sub-metrics are normalised onto 0-100 between a floor that counts as
 * failing and a ceiling that counts as excellent, then combined by weight.
 * A sub-metric whose inputs are unavailable is excluded and its weight is
 * redistributed, so a missing source lowers confidence rather than silently
 * dragging the score toward zero.
 */

export interface HealthBand {
  id: "critical" | "warning" | "healthy" | "excellent";
  label: string;
}

export interface HealthInput {
  netRevenue: number | null;
  adSpend: number | null;
  marginPct: number | null;
  landingPageViews: number | null;
  linkClicks: number | null;
  initiateCheckout: number | null;
  addToCart: number | null;
  ordersLinkedToVisitor: number | null;
  totalOrders: number | null;
}

export interface HealthComponent {
  key: string;
  label: string;
  weight: number;
  observed: number | null;
  display: string;
  score: number | null;
  available: boolean;
  reason: string;
}

export interface HealthResult {
  score: number | null;
  band: HealthBand | null;
  components: HealthComponent[];
  coveredWeight: number;
  note: string;
}

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

/** Maps a raw value onto 0-100 between a failing floor and an excellent ceiling. */
function normalise(value: number, floor: number, ceiling: number): number {
  return Number((clamp01((value - floor) / (ceiling - floor)) * 100).toFixed(1));
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator == null || denominator == null || !Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator <= 0) return null;
  return numerator / denominator;
}

export function healthBandFor(score: number): HealthBand {
  if (score < 40) return { id: "critical", label: "Something is broken, not merely soft" };
  if (score < 60) return { id: "warning", label: "Needs attention" };
  if (score < 80) return { id: "healthy", label: "Healthy" };
  return { id: "excellent", label: "An unusually good day" };
}

export function computeOperatingHealth(input: HealthInput): HealthResult {
  const mer = ratio(input.netRevenue, input.adSpend);
  const lpvOverClicks = ratio(input.landingPageViews, input.linkClicks);
  const checkoutOverCart = ratio(input.initiateCheckout, input.addToCart);
  const attribution = ratio(input.ordersLinkedToVisitor, input.totalOrders);

  const definitions: Array<Omit<HealthComponent, "available" | "reason"> & { reason: string }> = [
    {
      key: "mer",
      label: "Marketing efficiency",
      weight: 0.35,
      observed: mer,
      display: mer == null ? "Unavailable" : `${mer.toFixed(2)}×`,
      score: mer == null ? null : normalise(mer, 2, 10),
      reason: mer == null ? "Needs net revenue and ad spend in one currency." : "Net revenue divided by ad spend.",
    },
    {
      key: "margin",
      label: "Contribution margin",
      weight: 0.25,
      observed: input.marginPct,
      display: input.marginPct == null ? "Unavailable" : `${input.marginPct.toFixed(1)}%`,
      score: input.marginPct == null ? null : normalise(input.marginPct, 20, 60),
      reason: input.marginPct == null ? "Needs a complete profit calculation, including product cost." : "Profit as a share of revenue.",
    },
    {
      key: "landing",
      label: "Landing reliability",
      weight: 0.15,
      observed: lpvOverClicks,
      display: lpvOverClicks == null ? "Unavailable" : `${(lpvOverClicks * 100).toFixed(1)}%`,
      score: lpvOverClicks == null ? null : normalise(lpvOverClicks, 0.75, 0.95),
      reason: lpvOverClicks == null ? "Needs Meta link clicks and landing page views." : "Clicks that actually reached the page.",
    },
    {
      key: "checkout",
      label: "Checkout intent",
      weight: 0.15,
      observed: checkoutOverCart,
      display: checkoutOverCart == null ? "Unavailable" : `${(checkoutOverCart * 100).toFixed(1)}%`,
      score: checkoutOverCart == null ? null : normalise(checkoutOverCart, 0.3, 0.6),
      reason: checkoutOverCart == null ? "Needs add-to-cart and checkout counts." : "Carts that started a checkout.",
    },
    {
      key: "attribution",
      label: "Attribution coverage",
      weight: 0.1,
      observed: attribution,
      display: attribution == null ? "Unavailable" : `${(attribution * 100).toFixed(1)}%`,
      score: attribution == null ? null : Number((clamp01(attribution) * 100).toFixed(1)),
      reason: attribution == null ? "Needs paid orders in the period." : "Paid orders traceable to a tracked visitor.",
    },
  ];

  const components: HealthComponent[] = definitions.map(definition => ({
    ...definition,
    available: definition.score != null,
  }));

  const covered = components.filter(component => component.score != null);
  const coveredWeight = Number(covered.reduce((sum, component) => sum + component.weight, 0).toFixed(2));
  if (!covered.length || coveredWeight <= 0) {
    return { score: null, band: null, components, coveredWeight: 0, note: "No health input could be verified for this period." };
  }

  const weighted = covered.reduce((sum, component) => sum + (component.score as number) * component.weight, 0);
  const score = Math.round(weighted / coveredWeight);
  const missing = components.filter(component => component.score == null).map(component => component.label);

  return {
    score,
    band: healthBandFor(score),
    components,
    coveredWeight,
    note: missing.length
      ? `Scored on ${Math.round(coveredWeight * 100)}% of the model; ${missing.join(" and ")} could not be measured.`
      : "Scored on every input.",
  };
}
