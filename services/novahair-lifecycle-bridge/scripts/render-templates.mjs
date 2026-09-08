import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTemplateManifest } from "./lib/template-render.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = JSON.parse(await readFile(join(root, "content", "flows.json"), "utf8"));
const manifest = buildTemplateManifest(source);
if (manifest.count !== 39) throw new Error(`expected_39_templates_received_${manifest.count}`);

const htmlDir = join(root, "dist", "templates", "html");
const textDir = join(root, "dist", "templates", "text");
await Promise.all([mkdir(htmlDir, { recursive: true }), mkdir(textDir, { recursive: true })]);
for (const template of manifest.templates) {
  await Promise.all([
    writeFile(join(htmlDir, `${template.alias}.html`), template.html, "utf8"),
    writeFile(join(textDir, `${template.alias}.txt`), template.text, "utf8"),
  ]);
}
await writeFile(
  join(root, "dist", "templates", "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
console.log(`Rendered ${manifest.count} NovaHair templates.`);
