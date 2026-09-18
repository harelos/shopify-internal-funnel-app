-- "Preview on phone" for the page editor.
--
-- The draft is served by the Worker through the Shopify app proxy, inside the
-- live page's own shell, instead of on a twin Shopify page: this store serves
-- a freshly created page as 404 for many minutes, so the twin was never there
-- when the link was opened. One row per page; the token changes every time a
-- preview is written and a link stops working after a day.
CREATE TABLE IF NOT EXISTS "PageEditorPreview" (
  "handle" TEXT NOT NULL PRIMARY KEY,
  "token" TEXT NOT NULL,
  "nova" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
