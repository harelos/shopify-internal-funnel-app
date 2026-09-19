import { Router, raw } from "express";
import { randomUUID } from "node:crypto";
import { env as cloudflareEnv } from "cloudflare:workers";
import { ShopifyAdminClient } from "../lib/shopify-admin.js";
import { getShopifyConfig, workerEnvValue } from "../lib/shopify-config.js";
import { verifyShopifyAppProxyRequest } from "../middleware/shopify-auth.js";
import { BACKUPS_PER_PAGE, cleanEditorMarkup, editableHandle, previewIsCurrent, previewPath, previewToken, validateBody, validateNova } from "../lib/page-editor.js";
import { IMAGE_CONTENT_TYPES, MAX_IMAGE_BYTES, describeUploadError, safeImageFilename, uploadImageToShopifyFiles } from "../lib/shopify-files.js";

/**
 * The page editor's server side: read a sales page from Shopify, keep a draft,
 * preview it on the store's own domain through the app proxy, publish it
 * with a backup, restore a backup.
 * Nothing here touches the theme; only the page body changes, and every
 * publish leaves the previous body one click away.
 */
export const pageEditorAdminRouter = Router();
/** Storefront-facing: serves a draft inside the live page's shell at /apps/funnels/page-preview/:handle. */
export const pageEditorProxyRouter = Router();

const shopify = new ShopifyAdminClient();

type D1Like = {
  prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown>; all<T = any>(): Promise<{ results?: T[] }>; first<T = any>(): Promise<T | null> } };
};

function db(): D1Like {
  const envObj = (cloudflareEnv as any) ?? (globalThis as any).__SHOPIFY_WORKER_ENV__;
  const handle = envObj?.DB ?? (globalThis as any).__SHOPIFY_WORKER_ENV__?.DB;
  if (!handle) throw new Error("Cloudflare D1 binding DB is unavailable in the current request context.");
  return handle as D1Like;
}

interface ShopifyPage {
  id: string;
  handle: string;
  title: string;
  templateSuffix: string | null;
  body: string;
  updatedAt: string;
  isPublished: boolean;
}

async function findPage(handle: string): Promise<ShopifyPage | null> {
  const data = await shopify.adminGraphql<{ pages: { nodes: ShopifyPage[] } }>(`
    query EditorPage($query: String!) {
      pages(first: 5, query: $query) { nodes { id handle title templateSuffix body updatedAt isPublished } }
    }`, { query: `handle:${handle}` });
  return data.pages.nodes.find(page => page.handle === handle) || null;
}

async function updatePage(id: string, input: Record<string, unknown>) {
  const data = await shopify.adminGraphql<{ pageUpdate: { page: { id: string; updatedAt: string } | null; userErrors: Array<{ message: string }> } }>(`
    mutation EditorPublish($id: ID!, $page: PageUpdateInput!) {
      pageUpdate(id: $id, page: $page) { page { id updatedAt } userErrors { field message } }
    }`, { id, page: input });
  if (data.pageUpdate.userErrors.length) throw new Error(data.pageUpdate.userErrors.map(error => error.message).join("; "));
  return data.pageUpdate.page!;
}

async function createPage(input: Record<string, unknown>) {
  const data = await shopify.adminGraphql<{ pageCreate: { page: { id: string; handle: string } | null; userErrors: Array<{ message: string }> } }>(`
    mutation EditorPreviewPage($page: PageCreateInput!) {
      pageCreate(page: $page) { page { id handle } userErrors { field message } }
    }`, { page: input });
  if (data.pageCreate.userErrors.length) throw new Error(data.pageCreate.userErrors.map(error => error.message).join("; "));
  return data.pageCreate.page!;
}

function storefrontDomain(): string {
  return workerEnvValue("SHOPIFY_STOREFRONT_DOMAIN") || workerEnvValue("SHOP_DOMAIN");
}

function storefrontUrl(handle: string): string {
  return `https://${storefrontDomain()}/pages/${handle}`;
}

/** The live page as shoppers get it, scripts included; the editor shell and the phone preview both start from it. */
async function fetchStorefrontHtml(handle: string): Promise<string> {
  const url = storefrontUrl(handle);
  const response = await fetch(url, { headers: { "User-Agent": "FunnelControl page editor", Accept: "text/html" }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`The storefront returned HTTP ${response.status} for ${url}.`);
  return await response.text();
}

async function backupPage(page: ShopifyPage, note: string): Promise<string> {
  const handle = db();
  const id = randomUUID();
  await handle.prepare(`INSERT INTO "PageEditorBackup" ("id","handle","pageId","templateSuffix","body","note","createdAt") VALUES (?,?,?,?,?,?,?)`)
    .bind(id, page.handle, page.id, page.templateSuffix, page.body, note.slice(0, 200), new Date().toISOString()).run();
  await handle.prepare(`
    DELETE FROM "PageEditorBackup" WHERE "handle" = ? AND "id" NOT IN (
      SELECT "id" FROM "PageEditorBackup" WHERE "handle" = ? ORDER BY "createdAt" DESC LIMIT ?)`)
    .bind(page.handle, page.handle, BACKUPS_PER_PAGE).run();
  return id;
}

function fail(res: import("express").Response, error: unknown) {
  const message = String((error as Error)?.message || error).slice(0, 300);
  const status = /not a page handle|only opens|Body|limit|empty|would lose|No page/.test(message) ? 400 : 500;
  res.status(status).json({ error: message });
}

pageEditorAdminRouter.get("/page-editor/pages", async (_req, res) => {
  try {
    const data = await shopify.adminGraphql<{ pages: { nodes: Array<{ id: string; handle: string; title: string; templateSuffix: string | null; updatedAt: string; isPublished: boolean }> } }>(`
      { pages(first: 100, sortKey: UPDATED_AT, reverse: true) { nodes { id handle title templateSuffix updatedAt isPublished } } }`);
    const pages = data.pages.nodes.filter(page => {
      try { editableHandle(page.handle); return !page.handle.endsWith("-editor-preview"); } catch { return false; }
    }).map(page => ({ ...page, url: storefrontUrl(page.handle) }));
    res.json({ pages });
  } catch (error) { fail(res, error); }
});

pageEditorAdminRouter.get("/page-editor/pages/:handle", async (req, res) => {
  try {
    const handle = editableHandle(req.params.handle);
    const page = await findPage(handle);
    if (!page) return res.status(404).json({ error: `No page with the handle "${handle}".` });
    const store = db();
    const [draft, backups] = await Promise.all([
      store.prepare(`SELECT "body","note","updatedAt" FROM "PageEditorDraft" WHERE "handle" = ?`).bind(handle).first<{ body: string; note: string; updatedAt: string }>(),
      store.prepare(`SELECT "id","note","createdAt",length("body") AS bytes FROM "PageEditorBackup" WHERE "handle" = ? ORDER BY "createdAt" DESC LIMIT ?`).bind(handle, BACKUPS_PER_PAGE).all<{ id: string; note: string; createdAt: string; bytes: number }>(),
    ]);
    res.json({
      page: { ...page, url: storefrontUrl(handle) },
      draft: draft || null,
      backups: backups.results || [],
    });
  } catch (error) { fail(res, error); }
});

pageEditorAdminRouter.get("/page-editor/pages/:handle/shell", async (req, res) => {
  try {
    const handle = editableHandle(req.params.handle);
    const html = (await fetchStorefrontHtml(handle))
      .replace(/<script\b[\s\S]*?<\/script>/gi, "")
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, "")
      .replace(/<head>/i, `<head><base href="${storefrontUrl(handle)}">`);
    res.type("html").send(html);
  } catch (error) { fail(res, error); }
});

pageEditorAdminRouter.put("/page-editor/pages/:handle/draft", async (req, res) => {
  try {
    const handle = editableHandle(req.params.handle);
    const body = cleanEditorMarkup(validateBody(req.body?.body));
    const note = String(req.body?.note ?? "").slice(0, 200);
    const updatedAt = new Date().toISOString();
    await db().prepare(`
      INSERT INTO "PageEditorDraft" ("handle","body","note","updatedAt") VALUES (?,?,?,?)
      ON CONFLICT("handle") DO UPDATE SET "body" = excluded."body", "note" = excluded."note", "updatedAt" = excluded."updatedAt"`)
      .bind(handle, body, note, updatedAt).run();
    res.json({ ok: true, updatedAt, bytes: body.length });
  } catch (error) { fail(res, error); }
});

pageEditorAdminRouter.delete("/page-editor/pages/:handle/draft", async (req, res) => {
  try {
    const handle = editableHandle(req.params.handle);
    await db().prepare(`DELETE FROM "PageEditorDraft" WHERE "handle" = ?`).bind(handle).run();
    res.json({ ok: true });
  } catch (error) { fail(res, error); }
});

/** Keeps the draft's .nova root for the proxy route below; the link it returns is on the store's own domain. */
pageEditorAdminRouter.post("/page-editor/pages/:handle/preview", async (req, res) => {
  try {
    const handle = editableHandle(req.params.handle);
    const body = cleanEditorMarkup(validateBody(req.body?.body));
    const nova = cleanEditorMarkup(validateNova(req.body?.nova));
    const token = previewToken();
    await db().prepare(`
      INSERT INTO "PageEditorPreview" ("handle","token","nova","body","createdAt") VALUES (?,?,?,?,?)
      ON CONFLICT("handle") DO UPDATE SET "token" = excluded."token", "nova" = excluded."nova", "body" = excluded."body", "createdAt" = excluded."createdAt"`)
      .bind(handle, token, nova, body, new Date().toISOString()).run();
    res.json({ ok: true, url: `https://${storefrontDomain()}${previewPath(handle, token)}` });
  } catch (error) { fail(res, error); }
});

pageEditorAdminRouter.post("/page-editor/pages/:handle/publish", async (req, res) => {
  try {
    const handle = editableHandle(req.params.handle);
    const body = cleanEditorMarkup(validateBody(req.body?.body, { requireAnchors: true }));
    const page = await findPage(handle);
    if (!page) return res.status(404).json({ error: `No page with the handle "${handle}".` });
    if (page.body === body) return res.json({ ok: true, unchanged: true, updatedAt: page.updatedAt });
    const backupId = await backupPage(page, String(req.body?.note ?? "before publish"));
    const updated = await updatePage(page.id, { body });
    await db().prepare(`DELETE FROM "PageEditorDraft" WHERE "handle" = ?`).bind(handle).run();
    res.json({ ok: true, backupId, updatedAt: updated.updatedAt, url: storefrontUrl(handle) });
  } catch (error) { fail(res, error); }
});

/**
 * POST /api/page-editor/upload?filename=<name>&alt=<alt text>
 * Body: the picture's bytes, Content-Type image/png, image/jpeg or image/webp, at most 8 MB.
 * Reply: { ok, url, alt, width, height, fileId } once Shopify Files has processed it.
 *
 * The bytes travel raw rather than as base64 JSON: server.ts parses every
 * JSON body with a 2 MB cap before any router runs, so a JSON envelope
 * would cap pictures near 1.4 MB. The raw parser below is this route's own
 * and only reads image content types, so nothing else changes.
 */
const imageBody = raw({ type: [...IMAGE_CONTENT_TYPES], limit: MAX_IMAGE_BYTES + 64 * 1024 });
pageEditorAdminRouter.post("/page-editor/upload", (req, res, next) => imageBody(req, res, (error?: unknown) => {
  if (!error) return next();
  const tooLarge = (error as { type?: string })?.type === "entity.too.large";
  res.status(tooLarge ? 413 : 400).json({ error: tooLarge ? "The picture is bigger than 8 MB. Shrink it and try again." : "The picture could not be read." });
}), async (req, res) => {
  try {
    const contentType = String(req.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!IMAGE_CONTENT_TYPES.has(contentType) || !Buffer.isBuffer(req.body)) {
      return res.status(400).json({ error: "Send a PNG, JPG or WEBP picture as the request body, with its content type." });
    }
    const bytes = req.body as Buffer;
    if (!bytes.length) return res.status(400).json({ error: "The picture is empty." });
    if (bytes.length > MAX_IMAGE_BYTES) return res.status(413).json({ error: "The picture is bigger than 8 MB. Shrink it and try again." });
    const filename = safeImageFilename(req.query.filename, contentType);
    const alt = String(req.query.alt ?? "").slice(0, 300);
    const uploaded = await uploadImageToShopifyFiles({ bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), filename, contentType, alt }, shopify);
    res.json({ ok: true, ...uploaded });
  } catch (error) {
    const message = describeUploadError(error);
    res.status(/still processing/.test(message) ? 504 : /refused|missing the write_files|did not accept|could not process|Only PNG|empty|limit/.test(message) ? 400 : 502).json({ error: message });
  }
});

pageEditorAdminRouter.get("/page-editor/pages/:handle/backups/:id", async (req, res) => {
  try {
    const handle = editableHandle(req.params.handle);
    const backup = await db().prepare(`SELECT "id","handle","templateSuffix","body","note","createdAt" FROM "PageEditorBackup" WHERE "id" = ? AND "handle" = ?`)
      .bind(String(req.params.id), handle).first();
    if (!backup) return res.status(404).json({ error: "No such backup." });
    res.json({ backup });
  } catch (error) { fail(res, error); }
});

pageEditorAdminRouter.post("/page-editor/pages/:handle/restore/:id", async (req, res) => {
  try {
    const handle = editableHandle(req.params.handle);
    const backup = await db().prepare(`SELECT "id","templateSuffix","body","createdAt" FROM "PageEditorBackup" WHERE "id" = ? AND "handle" = ?`)
      .bind(String(req.params.id), handle).first<{ id: string; templateSuffix: string | null; body: string; createdAt: string }>();
    if (!backup) return res.status(404).json({ error: "No such backup." });
    const page = await findPage(handle);
    if (!page) return res.status(404).json({ error: `No page with the handle "${handle}".` });
    const safetyBackupId = await backupPage(page, `before restoring ${backup.createdAt}`);
    const updated = await updatePage(page.id, { body: backup.body, templateSuffix: backup.templateSuffix });
    res.json({ ok: true, restoredFrom: backup.id, safetyBackupId, updatedAt: updated.updatedAt });
  } catch (error) { fail(res, error); }
});

/**
 * GET /apps/funnels/page-preview/:handle?t=<token>
 * Shopify signs the request on its way through the app proxy. The live page is
 * fetched exactly as shoppers get it and its .nova root is swapped for the
 * draft's, so every script, style and relative link works and nothing on
 * Shopify changes. A twin Shopify page would have been simpler, but this store
 * serves a freshly created page as 404 for many minutes.
 */
pageEditorProxyRouter.get("/page-preview/:handle", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  try {
    if (getShopifyConfig().requireEmbeddedAuth && !verifyShopifyAppProxyRequest(req)) {
      return res.status(401).type("text/plain").send("This preview link only works on the store's own domain.");
    }
    const handle = editableHandle(req.params.handle);
    const row = await db().prepare(`SELECT "token","nova","createdAt" FROM "PageEditorPreview" WHERE "handle" = ?`)
      .bind(handle).first<{ token: string; nova: string; createdAt: string }>();
    if (!row || !previewIsCurrent(row, req.query.t)) {
      return res.status(404).type("text/plain").send("This preview link has expired. Press \"Preview on phone\" in the page editor for a fresh one.");
    }
    const shell = await fetchStorefrontHtml(handle);
    let swapped = 0;
    const html = await new HTMLRewriter()
      .on("head", { element(el) { el.prepend('<meta name="robots" content="noindex,nofollow">', { html: true }); } })
      .on(".nova", { element(el) { if (swapped++ === 0) el.replace(row.nova, { html: true }); } })
      .transform(new Response(shell, { headers: { "content-type": "text/html; charset=utf-8" } }))
      .text();
    if (!swapped) throw new Error("The live page has no .nova root to swap.");
    res.type("html").send(html);
  } catch (error) {
    const message = String((error as Error)?.message || error).slice(0, 300);
    res.status(/not a page handle|only opens/.test(message) ? 400 : 502).type("text/plain").send(`Preview unavailable: ${message}`);
  }
});
