#!/usr/bin/env node
// Uploads the storefront scripts in ./storefront to the live theme, and makes sure the
// sales-page layout loads the live beacon. Idempotent.
//
//   SHOP_DOMAIN=jacobfelipe.myshopify.com SHOPIFY_ADMIN_ACCESS_TOKEN=... node scripts/theme-assets.mjs
//   node scripts/theme-assets.mjs --check     -> compare only, change nothing
//
// The theme id and layout name are the NovaHair sales page's ("Updated copy of Dawn",
// layout novafunnel-staging-clean-v4). Nothing else in the theme is touched.
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const storefront = resolve(here, "../storefront");
const THEME = "gid://shopify/OnlineStoreTheme/182172320039";
const LAYOUT = "layout/novafunnel-staging-clean-v4.liquid";
const BEACON_TAG = `  <script src="{{ 'novahair-live-beacon.js' | asset_url }}" defer></script>`;
const check = process.argv.includes("--check");

const shop = process.env.SHOP_DOMAIN;
const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const version = process.env.SHOPIFY_API_VERSION || "2026-07";
if (!shop || !token) { console.error("SHOP_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN are required."); process.exit(1); }

async function gql(query, variables) {
  const response = await fetch(`https://${shop}/admin/api/${version}/graphql.json`, {
    method: "POST", headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors).slice(0, 300));
  return body.data;
}

const files = readdirSync(storefront).filter(name => /\.(js|css)$/.test(name)).map(name => ({ filename: `assets/${name}`, body: readFileSync(resolve(storefront, name), "utf8") }));
const wanted = [...files.map(file => file.filename), LAYOUT];
const current = await gql(`query($id: ID!, $names: [String!]!) { theme(id: $id) { files(first: 20, filenames: $names) { nodes { filename body { ... on OnlineStoreThemeFileBodyText { content } } } } } }`, { id: THEME, names: wanted });
const live = new Map((current.theme?.files?.nodes || []).map(node => [node.filename, node.body?.content ?? ""]));

const changes = [];
for (const file of files) if (live.get(file.filename) !== file.body) changes.push(file);
const layout = live.get(LAYOUT);
if (layout == null) { console.error(`Layout ${LAYOUT} is not in the theme; upload the sales page layout first.`); process.exit(1); }
if (!layout.includes("novahair-live-beacon.js")) {
  const patched = layout.replace(/\n\s*<\/body>/, `\n${BEACON_TAG}\n  </body>`);
  if (patched === layout) { console.error("Could not find </body> in the layout."); process.exit(1); }
  changes.push({ filename: LAYOUT, body: patched });
}

for (const file of files) console.log(`${live.has(file.filename) ? (live.get(file.filename) === file.body ? "same    " : "changed ") : "new     "} ${file.filename} (${file.body.length} chars)`);
console.log(`${layout.includes("novahair-live-beacon.js") ? "same    " : "changed "} ${LAYOUT} (beacon tag)`);
if (check || !changes.length) { console.log(changes.length ? "\n--check: nothing uploaded." : "\nTheme already matches."); process.exit(0); }

const result = await gql(`mutation($id: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) { themeFilesUpsert(themeId: $id, files: $files) { upsertedThemeFiles { filename } userErrors { field message } } }`,
  { id: THEME, files: changes.map(file => ({ filename: file.filename, body: { type: "TEXT", value: file.body } })) });
if (result.themeFilesUpsert.userErrors.length) { console.error(JSON.stringify(result.themeFilesUpsert.userErrors)); process.exit(1); }
console.log(`\nuploaded: ${result.themeFilesUpsert.upsertedThemeFiles.map(file => file.filename).join(", ")}`);
