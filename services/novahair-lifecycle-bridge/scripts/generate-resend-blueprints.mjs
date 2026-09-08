import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FLOW_SPECS } from "../src/flow-specs.ts";
import { buildAutomationBlueprints, EVENT_DEFINITIONS, toResendWorkflow } from "./lib/automation-blueprints.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, "dist", "resend");
await mkdir(output, { recursive: true });
const flowSpecs = Object.values(FLOW_SPECS);
const automations = buildAutomationBlueprints(flowSpecs);
if (automations.length !== 6) throw new Error(`expected_6_automations_received_${automations.length}`);
const templateManifest = JSON.parse(await readFile(join(root, "dist", "templates", "manifest.json"), "utf8"));
const subjects = new Map(templateManifest.templates.map(template => [template.alias, template.subject]));
const workflows = automations.map(automation => ({
  name: automation.name,
  status: "disabled",
  workflow: toResendWorkflow(automation, "__RESEND_FROM__", "__RESEND_REPLY_TO__", subjects),
}));
await Promise.all([
  writeFile(join(output, "events.json"), `${JSON.stringify(EVENT_DEFINITIONS, null, 2)}\n`, "utf8"),
  writeFile(join(output, "automations.json"), `${JSON.stringify({ count: automations.length, automations }, null, 2)}\n`, "utf8"),
  writeFile(join(output, "workflows.json"), `${JSON.stringify({ count: workflows.length, automations: workflows }, null, 2)}\n`, "utf8"),
]);
console.log(`Generated ${EVENT_DEFINITIONS.length} event definitions and ${automations.length} disabled automations.`);
