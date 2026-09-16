/**
 * Per-IP request limiting for storefront endpoints.
 *
 * Every public endpoint that writes needs one. Without it a single script can
 * inflate whatever the endpoint records — a page-view endpoint with no limit
 * turns "tracked visitors" into a number anyone can move, and conversion is
 * measured against it.
 *
 * Buckets live in the isolate, so a limit is per edge location rather than
 * global. That is enough to stop a script hammering one endpoint and costs no
 * storage round trip on the hot path.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();
const MAX_BUCKETS = 5000;

export function clientIp(req: { get?: (name: string) => string | undefined; ip?: string }): string {
  const header = req.get?.("cf-connecting-ip") || req.get?.("x-forwarded-for") || req.ip || "unknown";
  return String(header).split(",")[0].trim();
}

/** True when this caller has exceeded `max` requests for `action` in the window. */
export function requestLimited(
  req: { get?: (name: string) => string | undefined; ip?: string },
  action: string,
  max: number,
  windowMs: number,
): boolean {
  const key = `${action}:${clientIp(req)}`;
  const now = Date.now();
  if (buckets.size > MAX_BUCKETS) {
    for (const [bucketKey, value] of buckets) if (value.resetAt <= now) buckets.delete(bucketKey);
  }
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  bucket.count += 1;
  return bucket.count > max;
}

/**
 * Crawlers and preview fetchers render storefront pages too. Counting them as
 * visitors would divide real buyers by a denominator full of robots.
 */
const BOT_PATTERN = /bot|crawl|spider|slurp|bing|baidu|yandex|duckduck|facebookexternalhit|preview|monitor|headless|lighthouse|pagespeed|gtmetrix|semrush|ahrefs|screaming|curl|wget|python-requests|axios|node-fetch|postman/i;

export function looksLikeBot(userAgent: unknown): boolean {
  const agent = String(userAgent || "").trim();
  if (!agent) return true;
  return BOT_PATTERN.test(agent);
}
