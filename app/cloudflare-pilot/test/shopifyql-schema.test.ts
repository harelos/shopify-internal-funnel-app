import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const admin = readFileSync(path.join(root, "src/lib/shopify-admin.ts"), "utf8");
const method = admin.slice(admin.indexOf("async shopifyqlQuery"), admin.indexOf("async orderFinancialSummary"));
// Only the code, not the comment above it: that comment quotes the old broken
// selection on purpose.
const query = method.split(/\r?\n/).filter(line => !line.trim().startsWith("//")).join("\n");

/**
 * Shopify's 2026-07 Admin schema returns `ShopifyqlTableData.rows` as JSON and
 * `parseErrors` as a list of strings. Asking for the removed `rowData` field,
 * or selecting subfields on `parseErrors`, fails GraphQL validation, so every
 * request 502'd and the analytics card read "NOT CONNECTED".
 */
test("the ShopifyQL selection matches the live Admin schema", () => {
  assert.doesNotMatch(query, /rowData/, "still selects the removed rowData field");
  assert.doesNotMatch(query, /parseErrors\s*\{/, "still selects subfields on the scalar parseErrors list");
  assert.match(query, /tableData \{ columns \{ name dataType displayName \} rows \}/);
});

test("ShopifyQL runs as the app that actually holds read_reports", () => {
  // The Admin custom app is refused: "Access denied for shopifyqlQuery field.
  // Required access: read_reports". The Funnel Builder app grants it.
  assert.match(query, /await this\.appOwnedAccessToken\(sessionToken\)/);
});

test("the analytics page reads the same shape the query now returns", () => {
  const page = readFileSync(path.join(root, "public/admin/js/analytics.js"), "utf8");
  assert.match(page, /report\.tableData\?\.rows/);
  assert.match(page, /report\.tableData\?\.columns/);
});
