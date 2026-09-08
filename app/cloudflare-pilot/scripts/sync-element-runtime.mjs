import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { minify } from "terser";

const here = dirname(fileURLToPath(import.meta.url));
const pilotRoot = resolve(here, "..");
const extensionAssets = resolve(pilotRoot, "..", "extensions", "funnel-control-elements", "assets");
const extensionSource = resolve(pilotRoot, "storefront-source", "funnel-control-elements.js");
const publicAssets = resolve(pilotRoot, "public", "assets");

await mkdir(publicAssets, { recursive: true });
const source = await readFile(extensionSource, "utf8");
const compiled = await minify(source, { compress: { passes: 2 }, mangle: true, format: { comments: false } });
if (!compiled.code) throw new Error("Element runtime minification produced no JavaScript.");
const extensionRuntime = resolve(extensionAssets, "funnel-control-elements.js");
await writeFile(extensionRuntime, `${compiled.code}\n`, "utf8");
await copyFile(extensionRuntime, resolve(publicAssets, "funnel-control-elements.js"));
await copyFile(resolve(extensionAssets, "funnel-control-elements.css"), resolve(publicAssets, "funnel-control-elements.css"));

console.log("Built and synced the page-scoped element runtime into Worker public assets.");
