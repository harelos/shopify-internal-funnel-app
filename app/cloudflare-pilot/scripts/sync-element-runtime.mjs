import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pilotRoot = resolve(here, "..");
const extensionAssets = resolve(pilotRoot, "..", "extensions", "funnel-control-elements", "assets");
const publicAssets = resolve(pilotRoot, "public", "assets");

await mkdir(publicAssets, { recursive: true });
for (const filename of ["funnel-control-elements.js", "funnel-control-elements.css"]) {
  await copyFile(resolve(extensionAssets, filename), resolve(publicAssets, filename));
}

console.log("Synced the page-scoped element runtime into Worker public assets.");
