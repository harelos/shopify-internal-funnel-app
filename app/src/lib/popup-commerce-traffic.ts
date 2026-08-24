export const COMMERCE_TRAFFIC_CLASSES = [
  "QUALIFIED_PAID_COMMERCE",
  "QUALIFIED_EMAIL_COMMERCE",
  "QUALIFIED_ORGANIC_COMMERCE",
  "QUALIFIED_DIRECT_COMMERCE",
  "QUALIFIED_RETURNING_CUSTOMER_COMMERCE",
  "QUALIFIED_UNKNOWN_SOURCE_COMMERCE",
  "EXCLUDED_SUPPORT",
  "EXCLUDED_ORDER_TRACKING",
  "EXCLUDED_UNSUBSCRIBE",
  "EXCLUDED_INTERNAL_TEST",
  "EXCLUDED_BOT_OR_SCANNER",
  "EXCLUDED_NON_TARGET_MARKET",
  "NON_COMMERCIAL",
  "UNKNOWN",
] as const;

export const COMMERCE_TRAFFIC_GATE_MODES = ["exclude_known_bad", "qualified_only", "off"] as const;
export const COMMERCE_SOURCE_KINDS = ["paid", "email", "organic", "direct", "returning", "unknown"] as const;
export const COMMERCE_PAGE_ROLES = [
  "product",
  "collection",
  "homepage",
  "funnel",
  "cart",
  "checkout",
  "content",
  "contact",
  "tracking",
  "unsubscribe",
  "policy",
  "account",
  "unknown",
] as const;
export const COMMERCE_INTENTS = ["commerce", "support", "tracking", "unsubscribe", "unknown"] as const;

export type CommerceTrafficClass = (typeof COMMERCE_TRAFFIC_CLASSES)[number];
export type CommerceTrafficGateMode = (typeof COMMERCE_TRAFFIC_GATE_MODES)[number];
export type CommerceSourceKind = (typeof COMMERCE_SOURCE_KINDS)[number];
export type CommercePageRole = (typeof COMMERCE_PAGE_ROLES)[number];
export type CommerceIntent = (typeof COMMERCE_INTENTS)[number];
export type CommerceTrafficDecision = "QUALIFIED" | "EXCLUDED" | "UNKNOWN";
export type CommerceTrafficVerification = "COMPLETE" | "PARTIAL";

export interface QualifiedCommerceTrafficPolicy {
  version: number;
  targetCountries: string[];
}

export interface CommerceTrafficSignals {
  countryCode?: string | null;
  pagePath?: string;
  pageRole?: CommercePageRole;
  funnelId?: string | null;
  commercialIntent?: boolean | null;
  explicitIntent?: CommerceIntent;
  sourceKind?: CommerceSourceKind;
  trafficSource?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  referrer?: string | null;
  visitorState?: "new" | "returning" | "known" | "unknown";
  hasPurchaseHistory?: boolean | null;
  isInternalSession?: boolean;
  isTestSession?: boolean;
  suspectedBot?: boolean;
  humanLike?: boolean | null;
}

export interface CommerceTrafficClassification {
  policyVersion: number;
  decision: CommerceTrafficDecision;
  class: CommerceTrafficClass;
  isQualified: boolean;
  verification: CommerceTrafficVerification;
  sourceKind: CommerceSourceKind;
  pageRole: CommercePageRole;
  countryCode: string | null;
  reasonCodes: string[];
}

export const DEFAULT_TIGER_COMMERCE_TRAFFIC_POLICY: QualifiedCommerceTrafficPolicy = Object.freeze({
  version: 1,
  targetCountries: ["IL"],
});

const PAID_SOURCE_MARKERS = ["facebook", "instagram", "meta", "tiktok", "google_ads", "google-ads", "adwords"];
const PAID_MEDIUM_MARKERS = ["paid", "cpc", "ppc", "paid_social", "paid-social", "display"];
const EMAIL_MARKERS = ["email", "newsletter", "shopify_email", "shopify-email", "seguno"];
const ORGANIC_MARKERS = ["organic", "seo"];

function normalizePath(value: string | undefined): string {
  const path = String(value || "/").trim().split("?")[0].split("#")[0] || "/";
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return normalized.toLowerCase().replace(/\/+$/, "") || "/";
}

function normalizeCountry(value: string | null | undefined): string | null {
  const country = String(value || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : null;
}

function text(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase();
}

export function inferCommercePageRole(signals: CommerceTrafficSignals): CommercePageRole {
  if (signals.pageRole && COMMERCE_PAGE_ROLES.includes(signals.pageRole)) return signals.pageRole;
  const path = normalizePath(signals.pagePath);

  if (path === "/") return "homepage";
  if (path.startsWith("/products/")) return "product";
  if (path.startsWith("/collections/")) return "collection";
  if (path === "/cart" || path.startsWith("/cart/")) return "cart";
  if (path.startsWith("/checkout")) return "checkout";
  if (path === "/contact" || path.startsWith("/pages/contact")) return "contact";
  if (path.includes("unsubscribe")) return "unsubscribe";
  if (
    path.startsWith("/pages/track") ||
    path.startsWith("/pages/order-tracking") ||
    path.startsWith("/apps/track") ||
    path.startsWith("/account/orders") ||
    path.startsWith("/orders/")
  ) return "tracking";
  if (
    path.startsWith("/policies/") ||
    path.startsWith("/pages/privacy") ||
    path.startsWith("/pages/terms") ||
    path.startsWith("/pages/refund-policy") ||
    path.startsWith("/pages/shipping-policy")
  ) return "policy";
  if (path.startsWith("/account")) return "account";
  if (path.startsWith("/blogs/") || path.startsWith("/blog/")) return "content";
  if (signals.funnelId) return "funnel";
  return "unknown";
}

export function inferCommerceSourceKind(signals: CommerceTrafficSignals): CommerceSourceKind {
  if (signals.hasPurchaseHistory === true) return "returning";
  if (signals.sourceKind && COMMERCE_SOURCE_KINDS.includes(signals.sourceKind)) return signals.sourceKind;

  const source = `${text(signals.trafficSource)} ${text(signals.utmSource)} ${text(signals.referrer)}`;
  const medium = text(signals.utmMedium);
  if (EMAIL_MARKERS.some(marker => source.includes(marker)) || EMAIL_MARKERS.some(marker => medium.includes(marker))) return "email";
  if (PAID_MEDIUM_MARKERS.some(marker => medium.includes(marker)) || PAID_SOURCE_MARKERS.some(marker => source.includes(marker))) return "paid";
  if (ORGANIC_MARKERS.some(marker => medium.includes(marker))) return "organic";
  if (/google\.|bing\.|duckduckgo\.|yahoo\./.test(source)) return "organic";
  if (!text(signals.referrer) && !text(signals.utmSource) && !text(signals.trafficSource)) return "direct";
  return "unknown";
}

function qualifiedClass(sourceKind: CommerceSourceKind): CommerceTrafficClass {
  switch (sourceKind) {
    case "paid": return "QUALIFIED_PAID_COMMERCE";
    case "email": return "QUALIFIED_EMAIL_COMMERCE";
    case "organic": return "QUALIFIED_ORGANIC_COMMERCE";
    case "direct": return "QUALIFIED_DIRECT_COMMERCE";
    case "returning": return "QUALIFIED_RETURNING_CUSTOMER_COMMERCE";
    default: return "QUALIFIED_UNKNOWN_SOURCE_COMMERCE";
  }
}

function excluded(
  policy: QualifiedCommerceTrafficPolicy,
  trafficClass: CommerceTrafficClass,
  sourceKind: CommerceSourceKind,
  pageRole: CommercePageRole,
  countryCode: string | null,
  reasonCodes: string[],
): CommerceTrafficClassification {
  return {
    policyVersion: policy.version,
    decision: "EXCLUDED",
    class: trafficClass,
    isQualified: false,
    verification: countryCode ? "COMPLETE" : "PARTIAL",
    sourceKind,
    pageRole,
    countryCode,
    reasonCodes,
  };
}

function unknown(
  policy: QualifiedCommerceTrafficPolicy,
  sourceKind: CommerceSourceKind,
  pageRole: CommercePageRole,
  countryCode: string | null,
  reasonCodes: string[],
): CommerceTrafficClassification {
  return {
    policyVersion: policy.version,
    decision: "UNKNOWN",
    class: "UNKNOWN",
    isQualified: false,
    verification: "PARTIAL",
    sourceKind,
    pageRole,
    countryCode,
    reasonCodes,
  };
}

export function classifyCommerceTraffic(
  signals: CommerceTrafficSignals,
  policy: QualifiedCommerceTrafficPolicy = DEFAULT_TIGER_COMMERCE_TRAFFIC_POLICY,
): CommerceTrafficClassification {
  const pageRole = inferCommercePageRole(signals);
  const sourceKind = inferCommerceSourceKind(signals);
  const countryCode = normalizeCountry(signals.countryCode);
  const targetCountries = policy.targetCountries.map(country => country.trim().toUpperCase()).filter(Boolean);

  if (signals.isInternalSession || signals.isTestSession) {
    return excluded(policy, "EXCLUDED_INTERNAL_TEST", sourceKind, pageRole, countryCode, [signals.isInternalSession ? "internal_session" : "test_session"]);
  }
  if (signals.suspectedBot === true || signals.humanLike === false) {
    return excluded(policy, "EXCLUDED_BOT_OR_SCANNER", sourceKind, pageRole, countryCode, [signals.suspectedBot ? "suspected_bot" : "human_like_false"]);
  }

  if (signals.explicitIntent === "unsubscribe" || pageRole === "unsubscribe") {
    return excluded(policy, "EXCLUDED_UNSUBSCRIBE", sourceKind, pageRole, countryCode, ["unsubscribe_context"]);
  }
  if (signals.explicitIntent === "tracking" || pageRole === "tracking") {
    return excluded(policy, "EXCLUDED_ORDER_TRACKING", sourceKind, pageRole, countryCode, ["order_tracking_context"]);
  }
  if (signals.explicitIntent === "support" || pageRole === "contact") {
    return excluded(policy, "EXCLUDED_SUPPORT", sourceKind, pageRole, countryCode, ["support_context"]);
  }

  if (countryCode && targetCountries.length > 0 && !targetCountries.includes(countryCode)) {
    return excluded(policy, "EXCLUDED_NON_TARGET_MARKET", sourceKind, pageRole, countryCode, ["country_not_targeted"]);
  }

  if (signals.commercialIntent === false || ["policy", "account"].includes(pageRole)) {
    return excluded(policy, "NON_COMMERCIAL", sourceKind, pageRole, countryCode, ["non_commercial_page"]);
  }
  if (pageRole === "content" && signals.commercialIntent !== true) {
    return excluded(policy, "NON_COMMERCIAL", sourceKind, pageRole, countryCode, ["content_without_commercial_intent"]);
  }

  const commercialPage = ["product", "collection", "homepage", "funnel", "cart", "checkout"].includes(pageRole) || signals.commercialIntent === true || signals.explicitIntent === "commerce";
  if (!commercialPage) {
    return unknown(policy, sourceKind, pageRole, countryCode, ["commercial_intent_unverified"]);
  }

  const missingVerification: string[] = [];
  if (targetCountries.length > 0 && !countryCode) missingVerification.push("country_unverified");
  if (signals.humanLike !== true) missingVerification.push("human_like_unverified");
  if (missingVerification.length > 0) {
    return unknown(policy, sourceKind, pageRole, countryCode, ["commercial_context", ...missingVerification]);
  }

  return {
    policyVersion: policy.version,
    decision: "QUALIFIED",
    class: qualifiedClass(sourceKind),
    isQualified: true,
    verification: "COMPLETE",
    sourceKind,
    pageRole,
    countryCode,
    reasonCodes: ["commercial_context", "country_targeted", "human_like_observed"],
  };
}

export function commerceTrafficGateAllows(mode: CommerceTrafficGateMode, classification: CommerceTrafficClassification): boolean {
  if (mode === "off") return true;
  if (mode === "qualified_only") return classification.decision === "QUALIFIED";
  return classification.decision !== "EXCLUDED";
}
