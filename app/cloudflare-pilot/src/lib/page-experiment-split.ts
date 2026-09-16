/**
 * Pure traffic-splitting rules for page experiments.
 *
 * Kept free of runtime bindings so the split, the landing-page matching and the
 * query forwarding can all be tested directly.
 */

export interface PageExperimentVariantRow {
  id: string;
  key: string;
  label: string;
  landingPath: string;
  weight: number;
  isControl: number;
}

export const VISITOR_COOKIE = "fc_pe";
const VISITOR_KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Normalizes a storefront path so a variation always matches the same way,
 * whether Shopify reports it as a full URL, with a trailing slash, with a query
 * string, or behind a locale prefix such as /he-il.
 */
export function normalizeLandingPath(value: string): string {
  let path = String(value || "").trim();
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) {
    try { path = new URL(path).pathname; } catch { return ""; }
  }
  const queryIndex = path.search(/[?#]/);
  if (queryIndex >= 0) path = path.slice(0, queryIndex);
  if (!path.startsWith("/")) path = `/${path}`;
  path = path.replace(/\/+$/, "") || "/";
  path = path.replace(/^\/[a-z]{2}-[a-z]{2}(?=\/)/i, "");
  return (path || "/").toLowerCase();
}

export function isValidVisitorKey(value: string | undefined | null): value is string {
  return typeof value === "string" && VISITOR_KEY_PATTERN.test(value);
}

export function newVisitorKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Picks a variation deterministically from the visitor key, so the same visitor
 * keeps the same page even if the assignment write never lands.
 */
export function chooseVariant(variants: PageExperimentVariantRow[], visitorKey: string): PageExperimentVariantRow | null {
  const eligible = variants.filter(variant => Number(variant.weight) > 0);
  if (!eligible.length) return null;
  const totalWeight = eligible.reduce((sum, variant) => sum + Number(variant.weight), 0);
  let hash = 2166136261;
  for (let index = 0; index < visitorKey.length; index += 1) {
    hash ^= visitorKey.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  let bucket = (hash >>> 0) % totalWeight;
  for (const variant of eligible) {
    bucket -= Number(variant.weight);
    if (bucket < 0) return variant;
  }
  return eligible[eligible.length - 1];
}

/** Query parameters are forwarded so ad tracking survives the split. */
export function redirectTarget(landingPath: string, incomingQuery: string): string {
  const query = String(incomingQuery || "").replace(/^\?/, "");
  return query ? `${landingPath}?${query}` : landingPath;
}
