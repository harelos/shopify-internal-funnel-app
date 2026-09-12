import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildStandaloneTemplateManifest } from "./lib/template-render.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = JSON.parse(await readFile(join(root, "content", "shipment-v2-templates.json"), "utf8"));
const manifest = buildStandaloneTemplateManifest(source);
await mkdir(join(root, "dist", "templates"), { recursive: true });
await writeFile(join(root, "dist", "templates", "shipment-v2-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Rendered ${manifest.count} V2 shipment template drafts.`);
