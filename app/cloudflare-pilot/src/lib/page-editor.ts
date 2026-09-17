/**
 * The page editor changes real Shopify pages, so the rules that keep it from
 * doing damage live here where they can be tested: which pages it may touch,
 * how big a body may be, and that a body still contains the parts the page's
 * own scripts need to run.
 */

export const EDITABLE_HANDLE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_BODY_BYTES = 900_000;   // D1 keeps a row under 1 MB
export const BACKUPS_PER_PAGE = 30;

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
