import { Router } from "express";
import { randomUUID } from "node:crypto";
import { env as cloudflareEnv } from "cloudflare:workers";
import { ShopifyAdminClient } from "../lib/shopify-admin.js";
import { workerEnvValue } from "../lib/shopify-config.js";
import { BACKUPS_PER_PAGE, cleanEditorMarkup, editableHandle, validateBody } from "../lib/page-editor.js";

/**
 * The page editor's server side: read a sales page from Shopify, keep a draft,
 * preview it on a twin page, publish it with a backup, restore a backup.
 * Nothing here touches the theme; only the page body changes, and every
 * publish leaves the previous body one click away.
 */
export const pageEditorAdminRouter = Router();

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

function storefrontUrl(handle: string): string {
  const domain = workerEnvValue("SHOPIFY_STOREFRONT_DOMAIN") || workerEnvValue("SHOP_DOMAIN");
  return `https://${domain}/pages/${handle}`;
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
      previewUrl: storefrontUrl(`${handle}-editor-preview`),
    });
  } catch (error) { fail(res, error); }
});

pageEditorAdminRouter.get("/page-editor/pages/:handle/shell", async (req, res) => {
  try {
    const handle = editableHandle(req.params.handle);
    const url = storefrontUrl(handle);
    const response = await fetch(url, { headers: { "User-Agent": "FunnelControl page editor", Accept: "text/html" }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`The storefront returned HTTP ${response.status} for ${url}.`);
    const html = (await response.text())
      .replace(/<script\b[\s\S]*?<\/script>/gi, "")
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, "")
      .replace(/<head>/i, `<head><base href="${url}">`);
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

/** Writes the draft to a twin page so it can be opened on a phone before it goes live. */
pageEditorAdminRouter.post("/page-editor/pages/:handle/preview", async (req, res) => {
  try {
    const handle = editableHandle(req.params.handle);
    const body = cleanEditorMarkup(validateBody(req.body?.body));
    const source = await findPage(handle);
    if (!source) return res.status(404).json({ error: `No page with the handle "${handle}".` });
    const previewHandle = `${handle}-editor-preview`;
    const existing = await findPage(previewHandle);
    if (existing) {
      await updatePage(existing.id, { body, templateSuffix: source.templateSuffix, isPublished: true });
    } else {
      await createPage({ title: `Preview · ${source.title}`, handle: previewHandle, body, templateSuffix: source.templateSuffix, isPublished: true });
    }
    res.json({ ok: true, url: `${storefrontUrl(previewHandle)}?fc_internal=1&nocache=${Date.now()}` });
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
