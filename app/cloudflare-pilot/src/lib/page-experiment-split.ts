/**
 * Pure traffic-splitting rules for page experiments.
 *
 * Kept free of runtime bindings so the split, the landing-page matching, the
 * query forwarding and the admin edits can all be tested directly.
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
export const VISITOR_COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;
const VISITOR_KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
export const EXPERIMENT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/;

/**
 * Shopify signs every app-proxy request by appending these. They must not ride
 * along to the landing page: they would sit in the shopper's address bar, land
 * in referrers and analytics, and put a signature somewhere it does not belong.
 */
export const SHOPIFY_PROXY_PARAMS = new Set(["shop", "logged_in_customer_id", "path_prefix", "timestamp", "signature"]);

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
 * The first usable key wins. Our own cookie comes first; Shopify's long-lived
 * visitor id is the fallback, so a shopper keeps their page even when the app
 * proxy drops our Set-Cookie on the way back to the browser.
 */
export function reuseVisitorKey(candidates: Array<string | undefined | null>): string | null {
  for (const candidate of candidates) if (isValidVisitorKey(candidate)) return candidate;
  return null;
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

/** The shopper's own query parameters are forwarded so ad tracking survives the split. */
export function redirectTarget(landingPath: string, incomingQuery: string): string {
  const params = new URLSearchParams(String(incomingQuery || "").replace(/^\?/, ""));
  for (const name of [...params.keys()]) if (SHOPIFY_PROXY_PARAMS.has(name)) params.delete(name);
  const query = params.toString();
  return query ? `${landingPath}?${query}` : landingPath;
}

export function visitorCookie(visitorKey: string): string {
  // readable by the storefront so page scripts can report which variation they are on
  return `${VISITOR_COOKIE}=${encodeURIComponent(visitorKey)}; Path=/; Max-Age=${VISITOR_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax; Secure`;
}

/* ------------------------------------------------------------------ admin edits */

export interface WeightInput { id: string; weight: number }

/** Weights are whole percentages that add up to 100, so the panel and the split agree. */
export function normalizeWeights(input: unknown, knownIds: string[]): WeightInput[] {
  if (!Array.isArray(input) || !input.length) throw new Error("Send one percentage per variation.");
  const seen = new Set<string>();
  const rows = input.map(item => {
    const id = String((item as { id?: unknown })?.id ?? "").trim();
    const weight = Number((item as { weight?: unknown })?.weight);
    if (!knownIds.includes(id)) throw new Error("That variation is not part of this test.");
    if (seen.has(id)) throw new Error("A variation is listed twice.");
    if (!Number.isInteger(weight) || weight < 0 || weight > 100) throw new Error("Each share needs a whole number between 0 and 100.");
    seen.add(id);
    return { id, weight };
  });
  for (const id of knownIds) if (!seen.has(id)) throw new Error("Every variation needs a share.");
  const total = rows.reduce((sum, row) => sum + row.weight, 0);
  if (total !== 100) throw new Error(`The shares add up to ${total}, they must add up to 100.`);
  if (!rows.some(row => row.weight > 0)) throw new Error("At least one variation has to get traffic.");
  return knownIds.map(id => rows.find(row => row.id === id)!);
}

export function experimentStatus(value: unknown): "RUNNING" | "STOPPED" {
  const status = String(value ?? "").trim().toUpperCase();
  if (status !== "RUNNING" && status !== "STOPPED") throw new Error("A test is either RUNNING or STOPPED.");
  return status;
}

export interface NewPageExperiment {
  key: string;
  name: string;
  hypothesis: string;
  variants: Array<{ key: string; label: string; landingPath: string; weight: number; isControl: number }>;
}

/**
 * Validates a new whole-page test: two or more storefront paths, all different.
 * A full URL is accepted only for this shop's own storefront. Anything else is
 * refused rather than silently reduced to its path, which would send traffic
 * somewhere the person did not ask for.
 */
export function normalizeNewExperiment(input: unknown, storefrontHost = ""): NewPageExperiment {
  const allowed = String(storefrontHost || "").toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const source = (input ?? {}) as Record<string, unknown>;
  const key = String(source.key ?? "").trim().toLowerCase();
  if (!EXPERIMENT_KEY_PATTERN.test(key)) throw new Error("The short name may use lowercase letters, numbers, dashes and underscores, and must be at least two characters.");
  const name = String(source.name ?? "").trim().slice(0, 120) || `Page test "${key}"`;
  const hypothesis = String(source.hypothesis ?? "").trim().slice(0, 400);

  const rawVariants = Array.isArray(source.variants) ? source.variants : [];
  if (rawVariants.length < 2) throw new Error("A page test needs at least two pages.");
  if (rawVariants.length > 6) throw new Error("A page test takes at most six pages.");

  const paths = new Set<string>();
  const keys = new Set<string>();
  const variants = rawVariants.map((item, index) => {
    const row = (item ?? {}) as Record<string, unknown>;
    const raw = String(row.landingPath ?? "").trim();
    if (/^https?:\/\//i.test(raw)) {
      let host = "";
      try { host = new URL(raw).host.toLowerCase(); } catch { host = ""; }
      if (!host || !allowed || host !== allowed) {
        throw new Error(`"${raw}" is not a page on this store. Use a path such as /pages/my-page.`);
      }
    }
    const landingPath = normalizeLandingPath(raw);
    if (!/^\/[a-z0-9/_-]+$/.test(landingPath)) throw new Error(`"${String(row.landingPath ?? "")}" is not a storefront path such as /pages/my-page.`);
    if (paths.has(landingPath)) throw new Error(`Two variations point at ${landingPath}.`);
    paths.add(landingPath);
    const variantKey = (String(row.key ?? "").trim().toLowerCase() || String.fromCharCode(97 + index)).slice(0, 24);
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(variantKey)) throw new Error(`"${variantKey}" is not a usable variation name.`);
    if (keys.has(variantKey)) throw new Error(`Two variations are both called "${variantKey}".`);
    keys.add(variantKey);
    return {
      key: variantKey,
      label: String(row.label ?? "").trim().slice(0, 80) || `Version ${variantKey.toUpperCase()}`,
      landingPath,
      weight: Number.isInteger(Number(row.weight)) ? Number(row.weight) : 0,
      isControl: index === 0 ? 1 : 0,
    };
  });

  const total = variants.reduce((sum, variant) => sum + variant.weight, 0);
  if (total !== 100) {
    const even = Math.floor(100 / variants.length);
    variants.forEach((variant, index) => { variant.weight = index === 0 ? 100 - even * (variants.length - 1) : even; });
  }
  return { key, name, hypothesis, variants };
}
