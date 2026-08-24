import type { CommerceIntent, CommercePageRole } from "./popup-commerce-traffic.js";

export const POPUP_META_ENVIRONMENTS = [
  "INSTAGRAM_IOS_IN_APP",
  "INSTAGRAM_ANDROID_IN_APP",
  "FACEBOOK_IOS_IN_APP",
  "FACEBOOK_ANDROID_IN_APP",
  "META_IN_APP_UNKNOWN_OS",
  "NOT_META_IN_APP",
] as const;

export const POPUP_BROWSER_FAMILIES = [
  "SAFARI_IOS",
  "SAFARI_DESKTOP",
  "CHROME_ANDROID",
  "CHROME_IOS",
  "CHROME_DESKTOP",
  "SAMSUNG_INTERNET",
  "FIREFOX",
  "OTHER",
] as const;

export type PopupMetaEnvironment = (typeof POPUP_META_ENVIRONMENTS)[number];
export type PopupBrowserFamily = (typeof POPUP_BROWSER_FAMILIES)[number];

export interface PopupAcquisitionContext {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  fbclid: string | null;
  gclid: string | null;
  ttclid: string | null;
  adId: string | null;
  adsetId: string | null;
  campaignId: string | null;
  creativeId: string | null;
  placement: string | null;
}

export interface PopupClientBehaviorEvidence {
  interactionCount?: number;
  maxScrollDepthPct?: number;
  activeMs?: number;
  visibilityChanges?: number;
}

export interface PopupClientSessionSnapshot {
  pageUrl?: string | null;
  pagePath?: string | null;
  landingPath?: string | null;
  referrer?: string | null;
  userAgent?: string | null;
  language?: string | null;
  viewportWidth?: number | null;
  viewportHeight?: number | null;
  devicePixelRatio?: number | null;
  touchPoints?: number | null;
  anonymousVisitorState?: "new" | "returning" | "unknown";
  productHandle?: string | null;
  funnelId?: string | null;
  pageRole?: CommercePageRole;
  explicitIntent?: CommerceIntent;
  commercialIntent?: boolean | null;
  acquisition?: Partial<PopupAcquisitionContext> | null;
  behavior?: PopupClientBehaviorEvidence | null;
  clientInternalTest?: boolean;
  clientTestReason?: string | null;
}

export interface PopupServerCustomerContext {
  verified: boolean;
  hasPurchaseHistory: boolean;
  visitorState: "known" | "returning" | "new" | "unknown";
  source: "SHOPIFY_READ_ONLY" | "SIGNED_SERVER_CONTEXT" | "NONE";
}

export interface PopupNormalizedSessionContext {
  pageUrl: string | null;
  pagePath: string;
  landingPath: string;
  referrer: string | null;
  countryCode: string | null;
  countrySource: "EDGE_HEADER" | "TEST_HEADER" | "UNKNOWN";
  userAgent: string;
  browserFamily: PopupBrowserFamily;
  metaEnvironment: PopupMetaEnvironment;
  isMobile: boolean;
  deviceClass: "MOBILE" | "DESKTOP" | "TABLET" | "UNKNOWN";
  language: string | null;
  viewportWidth: number | null;
  viewportHeight: number | null;
  productHandle: string | null;
  funnelId: string | null;
  pageRole?: CommercePageRole;
  explicitIntent?: CommerceIntent;
  commercialIntent?: boolean | null;
  trafficSource: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  fbclid: string | null;
  gclid: string | null;
  ttclid: string | null;
  adId: string | null;
  adsetId: string | null;
  campaignId: string | null;
  creativeId: string | null;
  placement: string | null;
  humanLike: boolean | null;
  suspectedBot: boolean;
  humanEvidence: "CLIENT_INTERACTION" | "NO_INTERACTION_YET" | "AUTOMATION_UA";
  anonymousVisitorState: "new" | "returning" | "unknown";
  visitorState: "new" | "returning" | "known" | "unknown";
  hasPurchaseHistory: boolean | null;
  customerStateVerified: boolean;
  customerStateSource: PopupServerCustomerContext["source"];
  isInternalSession: boolean;
  isTestSession: boolean;
  internalTestReason: string | null;
  behavior: {
    interactionCount: number;
    maxScrollDepthPct: number;
    activeMs: number;
    visibilityChanges: number;
  };
}

const BOT_UA = /(bot|crawler|spider|slurp|headless|lighthouse|pagespeed|facebookexternalhit|preview|pingdom|uptimerobot|selenium|playwright|puppeteer)/i;

function boundedText(value: unknown, max = 500): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean ? clean.slice(0, max) : null;
}

function boundedNumber(value: unknown, min: number, max: number): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(max, Math.max(min, parsed));
}

function normalizePath(value: unknown, fallback = "/"): string {
  const raw = boundedText(value, 1200) || fallback;
  try {
    if (/^https?:\/\//i.test(raw)) return new URL(raw).pathname || "/";
  } catch {}
  const clean = raw.split(/[?#]/, 1)[0] || fallback;
  const prefixed = clean.startsWith("/") ? clean : `/${clean}`;
  return prefixed.slice(0, 800) || "/";
}

function normalizeCountry(value: unknown): string | null {
  const country = String(value || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : null;
}

function headerValue(headers: Record<string, unknown>, key: string): string | null {
  const value = headers[key] ?? headers[key.toLowerCase()];
  if (Array.isArray(value)) return boundedText(value[0], 100);
  return boundedText(value, 100);
}

export function edgeCountryFromHeaders(headers: Record<string, unknown>, allowTestHeader = false): { countryCode: string | null; source: PopupNormalizedSessionContext["countrySource"] } {
  const edgeCandidates = [
    headerValue(headers, "cf-ipcountry"),
    headerValue(headers, "x-vercel-ip-country"),
    headerValue(headers, "cloudfront-viewer-country"),
  ];
  for (const candidate of edgeCandidates) {
    const country = normalizeCountry(candidate);
    if (country) return { countryCode: country, source: "EDGE_HEADER" };
  }
  if (allowTestHeader) {
    const testCountry = normalizeCountry(headerValue(headers, "x-tiger-test-country"));
    if (testCountry) return { countryCode: testCountry, source: "TEST_HEADER" };
  }
  return { countryCode: null, source: "UNKNOWN" };
}

export function classifyPopupBrowser(userAgentInput: unknown): {
  browserFamily: PopupBrowserFamily;
  metaEnvironment: PopupMetaEnvironment;
  isMobile: boolean;
  deviceClass: PopupNormalizedSessionContext["deviceClass"];
  suspectedBot: boolean;
} {
  const ua = boundedText(userAgentInput, 1200) || "";
  const suspectedBot = BOT_UA.test(ua);
  const ios = /(iPhone|iPad|iPod)/i.test(ua);
  const android = /Android/i.test(ua);
  const mobile = /Mobile|Android|iPhone|iPod/i.test(ua);
  const tablet = /iPad|Tablet/i.test(ua) || (android && !/Mobile/i.test(ua));
  const instagram = /Instagram/i.test(ua);
  const facebook = /(FBAN|FBAV|FB_IAB|FB4A|FBIOS)/i.test(ua);

  let metaEnvironment: PopupMetaEnvironment = "NOT_META_IN_APP";
  if (instagram && ios) metaEnvironment = "INSTAGRAM_IOS_IN_APP";
  else if (instagram && android) metaEnvironment = "INSTAGRAM_ANDROID_IN_APP";
  else if (facebook && ios) metaEnvironment = "FACEBOOK_IOS_IN_APP";
  else if (facebook && android) metaEnvironment = "FACEBOOK_ANDROID_IN_APP";
  else if (instagram || facebook) metaEnvironment = "META_IN_APP_UNKNOWN_OS";

  let browserFamily: PopupBrowserFamily = "OTHER";
  if (/SamsungBrowser/i.test(ua)) browserFamily = "SAMSUNG_INTERNET";
  else if (/CriOS/i.test(ua)) browserFamily = "CHROME_IOS";
  else if (android && /Chrome\//i.test(ua)) browserFamily = "CHROME_ANDROID";
  else if (ios && /Safari\//i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua)) browserFamily = "SAFARI_IOS";
  else if (!mobile && /Chrome\//i.test(ua)) browserFamily = "CHROME_DESKTOP";
  else if (!mobile && /Safari\//i.test(ua) && !/Chrome|Chromium/i.test(ua)) browserFamily = "SAFARI_DESKTOP";
  else if (/Firefox|FxiOS/i.test(ua)) browserFamily = "FIREFOX";

  return {
    browserFamily,
    metaEnvironment,
    isMobile: mobile || tablet,
    deviceClass: tablet ? "TABLET" : mobile ? "MOBILE" : ua ? "DESKTOP" : "UNKNOWN",
    suspectedBot,
  };
}

function acquisition(input: PopupClientSessionSnapshot): PopupAcquisitionContext {
  const row = input.acquisition || {};
  return {
    utmSource: boundedText(row.utmSource, 200),
    utmMedium: boundedText(row.utmMedium, 200),
    utmCampaign: boundedText(row.utmCampaign, 300),
    utmContent: boundedText(row.utmContent, 300),
    utmTerm: boundedText(row.utmTerm, 300),
    fbclid: boundedText(row.fbclid, 500),
    gclid: boundedText(row.gclid, 500),
    ttclid: boundedText(row.ttclid, 500),
    adId: boundedText(row.adId, 200),
    adsetId: boundedText(row.adsetId, 200),
    campaignId: boundedText(row.campaignId, 200),
    creativeId: boundedText(row.creativeId, 200),
    placement: boundedText(row.placement, 200),
  };
}

function sourceFromAcquisition(row: PopupAcquisitionContext, referrer: string | null): string | null {
  if (row.utmSource) return row.utmSource.toLowerCase();
  const ref = (referrer || "").toLowerCase();
  if (ref.includes("instagram")) return "instagram";
  if (ref.includes("facebook") || row.fbclid) return "facebook";
  if (ref.includes("google")) return "google";
  if (ref.includes("bing")) return "bing";
  return null;
}

export function normalizePopupSessionContext(input: PopupClientSessionSnapshot, options: {
  headers?: Record<string, unknown>;
  allowTestCountryHeader?: boolean;
  serverCustomer?: PopupServerCustomerContext | null;
  serverInternal?: boolean;
  serverTest?: boolean;
} = {}): PopupNormalizedSessionContext {
  const ua = boundedText(input.userAgent, 1200) || "";
  const browser = classifyPopupBrowser(ua);
  const country = edgeCountryFromHeaders(options.headers || {}, options.allowTestCountryHeader === true);
  const acq = acquisition(input);
  const referrer = boundedText(input.referrer, 1200);
  const behavior = {
    interactionCount: Math.round(boundedNumber(input.behavior?.interactionCount, 0, 100_000) || 0),
    maxScrollDepthPct: Math.round(boundedNumber(input.behavior?.maxScrollDepthPct, 0, 100) || 0),
    activeMs: Math.round(boundedNumber(input.behavior?.activeMs, 0, 86_400_000) || 0),
    visibilityChanges: Math.round(boundedNumber(input.behavior?.visibilityChanges, 0, 100_000) || 0),
  };

  const humanLike = browser.suspectedBot ? false : behavior.interactionCount > 0 ? true : null;
  const customer = options.serverCustomer?.verified ? options.serverCustomer : null;
  const anonymousVisitorState = ["new", "returning", "unknown"].includes(String(input.anonymousVisitorState))
    ? input.anonymousVisitorState as "new" | "returning" | "unknown"
    : "unknown";

  const clientInternal = input.clientInternalTest === true;
  const isInternalSession = options.serverInternal === true || clientInternal;
  const isTestSession = options.serverTest === true || clientInternal;

  return {
    pageUrl: boundedText(input.pageUrl, 1600),
    pagePath: normalizePath(input.pagePath || input.pageUrl || "/"),
    landingPath: normalizePath(input.landingPath || input.pagePath || input.pageUrl || "/"),
    referrer,
    countryCode: country.countryCode,
    countrySource: country.source,
    userAgent: ua,
    browserFamily: browser.browserFamily,
    metaEnvironment: browser.metaEnvironment,
    isMobile: browser.isMobile,
    deviceClass: browser.deviceClass,
    language: boundedText(input.language, 80),
    viewportWidth: boundedNumber(input.viewportWidth, 0, 20_000),
    viewportHeight: boundedNumber(input.viewportHeight, 0, 20_000),
    productHandle: boundedText(input.productHandle, 200),
    funnelId: boundedText(input.funnelId, 200),
    pageRole: input.pageRole,
    explicitIntent: input.explicitIntent,
    commercialIntent: typeof input.commercialIntent === "boolean" ? input.commercialIntent : null,
    trafficSource: sourceFromAcquisition(acq, referrer),
    utmSource: acq.utmSource,
    utmMedium: acq.utmMedium,
    utmCampaign: acq.utmCampaign,
    utmContent: acq.utmContent,
    utmTerm: acq.utmTerm,
    fbclid: acq.fbclid,
    gclid: acq.gclid,
    ttclid: acq.ttclid,
    adId: acq.adId,
    adsetId: acq.adsetId,
    campaignId: acq.campaignId,
    creativeId: acq.creativeId,
    placement: acq.placement,
    humanLike,
    suspectedBot: browser.suspectedBot,
    humanEvidence: browser.suspectedBot ? "AUTOMATION_UA" : behavior.interactionCount > 0 ? "CLIENT_INTERACTION" : "NO_INTERACTION_YET",
    anonymousVisitorState,
    visitorState: customer ? customer.visitorState : anonymousVisitorState,
    hasPurchaseHistory: customer ? customer.hasPurchaseHistory : null,
    customerStateVerified: Boolean(customer),
    customerStateSource: customer?.source || "NONE",
    isInternalSession,
    isTestSession,
    internalTestReason: isInternalSession ? boundedText(input.clientTestReason, 200) || (options.serverInternal ? "server_internal" : "client_test_marker") : null,
    behavior,
  };
}

export function toPopupEligibilityContext(context: PopupNormalizedSessionContext) {
  return {
    pagePath: context.pagePath,
    productHandle: context.productHandle,
    funnelId: context.funnelId,
    countryCode: context.countryCode,
    pageRole: context.pageRole,
    commercialIntent: context.commercialIntent,
    explicitIntent: context.explicitIntent,
    trafficSource: context.trafficSource,
    referrer: context.referrer,
    utmSource: context.utmSource,
    utmMedium: context.utmMedium,
    visitorState: context.visitorState,
    hasPurchaseHistory: context.hasPurchaseHistory,
    isInternalSession: context.isInternalSession,
    isTestSession: context.isTestSession,
    suspectedBot: context.suspectedBot,
    humanLike: context.humanLike,
    isMobile: context.isMobile,
  };
}
