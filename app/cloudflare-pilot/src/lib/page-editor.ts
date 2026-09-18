/**
 * The page editor changes real Shopify pages, so the rules that keep it from
 * doing damage live here where they can be tested: which pages it may touch,
 * how big a body may be, that a body still contains the parts the page's
 * own scripts need to run, and how a "preview on phone" link is minted and
 * checked.
 */
import { randomUUID, timingSafeEqual } from "node:crypto";

export const EDITABLE_HANDLE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_BODY_BYTES = 900_000;   // D1 keeps a row under 1 MB
export const BACKUPS_PER_PAGE = 30;
/** A preview link works for a day; every "Preview on phone" mints a fresh one. */
export const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;

/** Pages the editor may open. Sales pages only; never the theme's system pages. */
export function editableHandle(value: unknown): string {
  const handle = String(value ?? "").trim().toLowerCase();
  if (!EDITABLE_HANDLE.test(handle) || handle.length > 80) throw new Error("That is not a page handle.");
  if (!/sales|funnel|landing|offer|qa/.test(handle)) throw new Error("The editor only opens sales, funnel, landing and offer pages.");
  return handle;
}

/** Element ids the page's own JavaScript looks up; publishing without them breaks the buy box. */
export const REQUIRED_ANCHORS = ["buy", "mainCheckout", "stickyBuyBar", "galMain"];

export function missingAnchors(body: string, anchors = REQUIRED_ANCHORS): string[] {
  return anchors.filter(id => !new RegExp(`\\bid=["']${id}["']`).test(body));
}

export function validateBody(body: unknown, options: { requireAnchors?: boolean } = {}): string {
  if (typeof body !== "string") throw new Error("Body must be HTML text.");
  const bytes = new TextEncoder().encode(body).length;
  if (!bytes) throw new Error("Body is empty.");
  if (bytes > MAX_BODY_BYTES) throw new Error(`Body is ${Math.round(bytes / 1024)} KB; the limit is ${Math.round(MAX_BODY_BYTES / 1024)} KB.`);
  if (options.requireAnchors) {
    const missing = missingAnchors(body);
    if (missing.length) throw new Error(`The page would lose parts its scripts need: #${missing.join(", #")}. Restore them before publishing.`);
  }
  return body;
}

/** Everything the editor strips before it returns HTML to Shopify. */
export function cleanEditorMarkup(body: string): string {
  return body
    .replace(/\s+data-nh-edit-id="[^"]*"/g, "")
    .replace(/\s+contenteditable="(?:true|false)"/g, "")
    .replace(/\s+spellcheck="false"/g, "");
}

/**
 * The preview swaps the page's `.nova` root: that is the part the editor edits
 * and the part the Worker drops into the live shell. Anything else is refused.
 */
export function validateNova(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("This page has no .nova root, so it cannot be previewed on a phone. Publishing still works.");
  const bytes = new TextEncoder().encode(value).length;
  if (bytes > MAX_BODY_BYTES) throw new Error(`Preview is ${Math.round(bytes / 1024)} KB; the limit is ${Math.round(MAX_BODY_BYTES / 1024)} KB.`);
  if (!/^\s*<[a-z][a-z0-9-]*\b[^>]*\bclass=["'][^"']*\bnova\b/i.test(value)) throw new Error("Preview markup must start with the page's .nova element.");
  return value;
}

export function previewToken(): string {
  return randomUUID().replace(/-/g, "");
}

/**
 * Served through the Shopify app proxy on the store's own domain, so relative
 * assets, the cart and the beacon all work; fc_internal keeps the visit out of
 * the live feed.
 */
export function previewPath(handle: string, token: string): string {
  return `/apps/funnels/page-preview/${encodeURIComponent(handle)}?t=${token}&fc_internal=1`;
}

export function previewIsCurrent(row: { token: string; createdAt: string } | null | undefined, token: unknown, now = Date.now()): boolean {
  if (!row || typeof token !== "string") return false;
  if (!/^[a-f0-9]{32}$/.test(token) || !/^[a-f0-9]{32}$/.test(row.token)) return false;
  if (!timingSafeEqual(Buffer.from(row.token), Buffer.from(token))) return false;
  const age = now - Date.parse(row.createdAt);
  return Number.isFinite(age) && age > -60_000 && age < PREVIEW_TTL_MS;
}
