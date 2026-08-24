import { COMMERCE_TRAFFIC_GATE_MODES, type CommerceTrafficGateMode } from "./popup-commerce-traffic.js";

export const POPUP_TYPES = [
  "lead_capture",
  "discount_reveal",
  "quiz",
  "product_finder",
  "bundle_suggestion",
  "browse_abandonment",
  "cart_rescue",
  "reorder",
  "support_rescue",
  "returning_customer",
  "content_guide",
  "shipping_threshold",
] as const;

export const POPUP_TRIGGER_MODES = ["time", "scroll", "inactivity", "exit", "cart", "manual"] as const;
export const POPUP_VISITOR_STATES = ["any", "new", "returning", "known", "unknown"] as const;

export type PopupType = (typeof POPUP_TYPES)[number];
export type PopupTriggerMode = (typeof POPUP_TRIGGER_MODES)[number];
export type PopupVisitorState = (typeof POPUP_VISITOR_STATES)[number];

export interface PopupCreative {
  eyebrow: string;
  title: string;
  body: string;
  ctaLabel: string;
  secondaryLabel: string;
  imageUrl: string;
  direction: "rtl" | "ltr" | "auto";
  formMode: "none" | "email" | "email_name" | "quiz";
}

export interface PopupVariantConfig {
  key: string;
  name: string;
  weightBasisPoints: number;
  creative: PopupCreative;
}

export interface PopupTriggerConfig {
  mode: PopupTriggerMode;
  seconds: number;
  scrollPct: number;
  inactivitySeconds: number;
  requireCartItems: boolean;
  desktopExitOnly: boolean;
}

export interface PopupTargetingConfig {
  includePaths: string[];
  excludePaths: string[];
  productHandles: string[];
  funnelIds: string[];
  trafficSources: string[];
  referrerContains: string[];
  utmSources: string[];
  visitorState: PopupVisitorState;
  cartMinSubtotal: number | null;
  cartMaxSubtotal: number | null;
  requireCartItems: boolean;
  commerceTrafficMode: CommerceTrafficGateMode;
  qualifiedCountries: string[];
}

export interface PopupFrequencyConfig {
  suppressAfterCloseMinutes: number;
  suppressAfterSubmitDays: number;
  maxImpressionsPerSession: number;
  maxImpressionsPerVisitorDay: number;
}

export interface PopupDeliveryConfig {
  priority: number;
  conflictGroup: string;
  globalCooldownSeconds: number;
  deferWhenOverlayOpen: boolean;
  reserveCartForCartCampaigns: boolean;
  suppressOnCheckout: boolean;
}

export interface PopupSafetyConfig {
  visibleCloseButton: true;
  escClose: true;
  localImmediateClose: true;
  backdropClose: boolean;
  restoreFocus: true;
  cleanupBodyScroll: true;
  maxOpenMs: number;
}

export interface PopupCampaignConfig {
  key: string;
  name: string;
  type: PopupType;
  status: "DRAFT" | "PAUSED";
  experimentVersion: number;
  trigger: PopupTriggerConfig;
  targeting: PopupTargetingConfig;
  frequency: PopupFrequencyConfig;
  delivery: PopupDeliveryConfig;
  safety: PopupSafetyConfig;
  variants: PopupVariantConfig[];
}

const DEFAULT_CREATIVE: PopupCreative = {
  eyebrow: "TIGER BRANDS",
  title: "רוצה עזרה לבחור נכון?",
  body: "הצעה או המלצה רלוונטית תופיע כאן רק כאשר תנאי הקמפיין מתקיימים.",
  ctaLabel: "המשך",
  secondaryLabel: "לא עכשיו",
  imageUrl: "",
  direction: "rtl",
  formMode: "none",
};

export function defaultPopupCampaign(): PopupCampaignConfig {
  return {
    key: "popup-draft-1",
    name: "Popup draft 1",
    type: "lead_capture",
    status: "DRAFT",
    experimentVersion: 1,
    trigger: {
      mode: "time",
      seconds: 20,
      scrollPct: 50,
      inactivitySeconds: 30,
      requireCartItems: false,
      desktopExitOnly: true,
    },
    targeting: {
      includePaths: [],
      excludePaths: [],
      productHandles: [],
      funnelIds: [],
      trafficSources: [],
      referrerContains: [],
      utmSources: [],
      visitorState: "any",
      cartMinSubtotal: null,
      cartMaxSubtotal: null,
      requireCartItems: false,
      commerceTrafficMode: "exclude_known_bad",
      qualifiedCountries: ["IL"],
    },
    frequency: {
      suppressAfterCloseMinutes: 1440,
      suppressAfterSubmitDays: 30,
      maxImpressionsPerSession: 1,
      maxImpressionsPerVisitorDay: 1,
    },
    delivery: {
      priority: 50,
      conflictGroup: "global",
      globalCooldownSeconds: 30,
      deferWhenOverlayOpen: true,
      reserveCartForCartCampaigns: true,
      suppressOnCheckout: true,
    },
    safety: {
      visibleCloseButton: true,
      escClose: true,
      localImmediateClose: true,
      backdropClose: true,
      restoreFocus: true,
      cleanupBodyScroll: true,
      maxOpenMs: 300000,
    },
    variants: [
      { key: "control", name: "Control", weightBasisPoints: 5000, creative: { ...DEFAULT_CREATIVE } },
      { key: "b", name: "B", weightBasisPoints: 5000, creative: { ...DEFAULT_CREATIVE, title: "יש משהו שיכול להתאים לך" } },
    ],
  };
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown, fallback: string, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : fallback;
}

function numberValue(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function nullableMoney(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : null;
}

function stringArray(value: unknown, maxItems = 50): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(item => typeof item === "string").map(item => item.trim()).filter(Boolean))].slice(0, maxItems);
}

function countryArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const normalized = [...new Set(value
    .filter(item => typeof item === "string")
    .map(item => item.trim().toUpperCase())
    .filter(item => /^[A-Z]{2}$/.test(item)))].slice(0, 50);
  return normalized.length ? normalized : [...fallback];
}

function enumValue<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  return typeof value === "string" && allowed.includes(value) ? value as T[number] : fallback;
}

function normalizeCreative(input: unknown, fallback = DEFAULT_CREATIVE): PopupCreative {
  const row = object(input);
  return {
    eyebrow: stringValue(row.eyebrow, fallback.eyebrow, 80),
    title: stringValue(row.title, fallback.title, 160),
    body: stringValue(row.body, fallback.body, 800),
    ctaLabel: stringValue(row.ctaLabel, fallback.ctaLabel, 80),
    secondaryLabel: stringValue(row.secondaryLabel, fallback.secondaryLabel, 80),
    imageUrl: stringValue(row.imageUrl, fallback.imageUrl, 800),
    direction: enumValue(row.direction, ["rtl", "ltr", "auto"] as const, fallback.direction),
    formMode: enumValue(row.formMode, ["none", "email", "email_name", "quiz"] as const, fallback.formMode),
  };
}

export function normalizeAndValidatePopupCampaign(input: unknown): { ok: boolean; errors: string[]; config?: PopupCampaignConfig } {
  const defaults = defaultPopupCampaign();
  const row = object(input);
  const trigger = object(row.trigger);
  const targeting = object(row.targeting);
  const frequency = object(row.frequency);
  const delivery = object(row.delivery);
  const safety = object(row.safety);
  const errors: string[] = [];

  const key = stringValue(row.key, defaults.key, 80).toLowerCase().replace(/[^a-z0-9-_]/g, "-").replace(/-+/g, "-");
  if (!key) errors.push("Campaign key is required.");

  const variantRows = Array.isArray(row.variants) ? row.variants.slice(0, 12) : defaults.variants;
  const variants: PopupVariantConfig[] = variantRows.map((item, index) => {
    const variant = object(item);
    const keyFallback = index === 0 ? "control" : String.fromCharCode(97 + Math.min(index, 25));
    return {
      key: stringValue(variant.key, keyFallback, 40).toLowerCase().replace(/[^a-z0-9-_]/g, "-"),
      name: stringValue(variant.name, index === 0 ? "Control" : `Variant ${index + 1}`, 80),
      weightBasisPoints: Math.round(numberValue(variant.weightBasisPoints, Math.floor(10000 / Math.max(1, variantRows.length)), 0, 10000)),
      creative: normalizeCreative(variant.creative, defaults.variants[Math.min(index, defaults.variants.length - 1)]?.creative || DEFAULT_CREATIVE),
    };
  });

  if (variants.length < 1) errors.push("At least one popup variant is required.");
  if (new Set(variants.map(variant => variant.key)).size !== variants.length) errors.push("Popup variant keys must be unique.");
  const totalWeight = variants.reduce((sum, variant) => sum + variant.weightBasisPoints, 0);
  if (totalWeight !== 10000) errors.push(`Variant weights must total 10000 basis points; received ${totalWeight}.`);

  const cartMinSubtotal = nullableMoney(targeting.cartMinSubtotal);
  const cartMaxSubtotal = nullableMoney(targeting.cartMaxSubtotal);
  if (cartMinSubtotal !== null && cartMaxSubtotal !== null && cartMaxSubtotal < cartMinSubtotal) {
    errors.push("cartMaxSubtotal must be greater than or equal to cartMinSubtotal.");
  }

  const conflictGroup = stringValue(delivery.conflictGroup, defaults.delivery.conflictGroup, 80)
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-") || "global";

  const config: PopupCampaignConfig = {
    key,
    name: stringValue(row.name, defaults.name, 120),
    type: enumValue(row.type, POPUP_TYPES, defaults.type),
    status: enumValue(row.status, ["DRAFT", "PAUSED"] as const, "DRAFT"),
    experimentVersion: Math.round(numberValue(row.experimentVersion, defaults.experimentVersion, 1, 1_000_000)),
    trigger: {
      mode: enumValue(trigger.mode, POPUP_TRIGGER_MODES, defaults.trigger.mode),
      seconds: numberValue(trigger.seconds, defaults.trigger.seconds, 0, 3600),
      scrollPct: numberValue(trigger.scrollPct, defaults.trigger.scrollPct, 0, 100),
      inactivitySeconds: numberValue(trigger.inactivitySeconds, defaults.trigger.inactivitySeconds, 1, 3600),
      requireCartItems: Boolean(trigger.requireCartItems),
      desktopExitOnly: trigger.desktopExitOnly !== false,
    },
    targeting: {
      includePaths: stringArray(targeting.includePaths),
      excludePaths: stringArray(targeting.excludePaths),
      productHandles: stringArray(targeting.productHandles),
      funnelIds: stringArray(targeting.funnelIds),
      trafficSources: stringArray(targeting.trafficSources),
      referrerContains: stringArray(targeting.referrerContains),
      utmSources: stringArray(targeting.utmSources),
      visitorState: enumValue(targeting.visitorState, POPUP_VISITOR_STATES, defaults.targeting.visitorState),
      cartMinSubtotal,
      cartMaxSubtotal,
      requireCartItems: Boolean(targeting.requireCartItems),
      commerceTrafficMode: enumValue(targeting.commerceTrafficMode, COMMERCE_TRAFFIC_GATE_MODES, defaults.targeting.commerceTrafficMode),
      qualifiedCountries: countryArray(targeting.qualifiedCountries, defaults.targeting.qualifiedCountries),
    },
    frequency: {
      suppressAfterCloseMinutes: numberValue(frequency.suppressAfterCloseMinutes, defaults.frequency.suppressAfterCloseMinutes, 0, 525600),
      suppressAfterSubmitDays: numberValue(frequency.suppressAfterSubmitDays, defaults.frequency.suppressAfterSubmitDays, 0, 3650),
      maxImpressionsPerSession: Math.round(numberValue(frequency.maxImpressionsPerSession, defaults.frequency.maxImpressionsPerSession, 1, 100)),
      maxImpressionsPerVisitorDay: Math.round(numberValue(frequency.maxImpressionsPerVisitorDay, defaults.frequency.maxImpressionsPerVisitorDay, 1, 100)),
    },
    delivery: {
      priority: Math.round(numberValue(delivery.priority, defaults.delivery.priority, 0, 1000)),
      conflictGroup,
      globalCooldownSeconds: Math.round(numberValue(delivery.globalCooldownSeconds, defaults.delivery.globalCooldownSeconds, 0, 3600)),
      deferWhenOverlayOpen: delivery.deferWhenOverlayOpen !== false,
      reserveCartForCartCampaigns: delivery.reserveCartForCartCampaigns !== false,
      suppressOnCheckout: delivery.suppressOnCheckout !== false,
    },
    safety: {
      visibleCloseButton: true,
      escClose: true,
      localImmediateClose: true,
      backdropClose: safety.backdropClose !== false,
      restoreFocus: true,
      cleanupBodyScroll: true,
      maxOpenMs: Math.round(numberValue(safety.maxOpenMs, defaults.safety.maxOpenMs, 5000, 900000)),
    },
    variants,
  };

  return { ok: errors.length === 0, errors, config };
}
