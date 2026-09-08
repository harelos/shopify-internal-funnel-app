import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toResendWorkflow } from "./lib/automation-blueprints.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const apply = process.argv.includes("--apply-disabled");
const apiKey = process.env.RESEND_API_KEY?.trim();
const from = process.env.RESEND_FROM?.trim();
const replyTo = process.env.RESEND_REPLY_TO?.trim();
const workerUrl = process.env.LIFECYCLE_WORKER_URL?.replace(/\/$/, "");
const adminToken = process.env.LIFECYCLE_ADMIN_TOKEN?.trim();

if (!apiKey) throw new Error("RESEND_API_KEY must be supplied by the authenticated service bootstrap; never paste it into source.");
if (apply && (!from || !replyTo)) throw new Error("RESEND_FROM and RESEND_REPLY_TO are required for disabled provisioning.");

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function resend(path, options = {}) {
  const method = options.method ?? "GET";
  const canRetry = method === "GET" || method === "PATCH" || /\/publish$/.test(path);
  let response;
  for (let attempt = 0; attempt < (canRetry ? 4 : 1); attempt += 1) {
    try {
      response = await fetch(`https://api.resend.com${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": "novahair-lifecycle-provisioner/1.0",
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      if (!canRetry || attempt === 3) throw new Error(`resend_network_error:${method}:${path}`);
      await sleep(400 * 2 ** attempt);
      continue;
    }
    if ([429, 502, 503, 504].includes(response.status) && canRetry && attempt < 3) {
      const retryAfter = Number(response.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : 400 * 2 ** attempt);
      continue;
    }
    break;
  }
  if (!response) throw new Error(`resend_no_response:${method}:${path}`);
  if (options.allow?.includes(response.status)) return null;
  let body = null;
  try { body = await response.json(); } catch { /* status is sufficient */ }
  if (!response.ok) {
    const code = typeof body?.name === "string" ? body.name.replace(/[^a-z0-9_-]/gi, "_").slice(0, 80) : "request_failed";
    throw new Error(`resend_${response.status}:${code}:${method}:${path}`);
  }
  return body;
}

function dataList(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

async function optional(path) {
  try { return await resend(path); } catch (error) {
    if (/resend_(403|404):/.test(String(error))) return null;
    throw error;
  }
}

function safeAudit(raw) {
  const keys = dataList(raw.apiKeys).map(item => ({ id: item.id, name: item.name, permission: item.permission, created_at: item.created_at }));
  const domains = dataList(raw.domains).map(item => ({ id: item.id, name: item.name, status: item.status, region: item.region, created_at: item.created_at }));
  const events = dataList(raw.events).map(item => ({ id: item.id, name: item.name, schema: item.schema, created_at: item.created_at, updated_at: item.updated_at }));
  const templates = dataList(raw.templates).map(item => ({ id: item.id, alias: item.alias, name: item.name, status: item.status, published_at: item.published_at, updated_at: item.updated_at }));
  const automations = dataList(raw.automations).map(item => ({ id: item.id, name: item.name, status: item.status, created_at: item.created_at, updated_at: item.updated_at }));
  const webhooks = dataList(raw.webhooks).map(item => ({ id: item.id, status: item.status, events: item.events, created_at: item.created_at }));
  return {
    audited_at: new Date().toISOString(),
    counts: {
      api_keys: keys.length,
      domains: domains.length,
      events: events.length,
      templates: templates.length,
      automations: automations.length,
      contacts_page: dataList(raw.contacts).length,
      webhooks: webhooks.length,
      suppressions_page: dataList(raw.suppressions).length,
    },
    api_keys: keys,
    domains,
    events,
    templates,
    automations,
    webhooks,
    usage: raw.usage ? {
      generated_at: raw.usage.generated_at,
      emails: raw.usage.emails,
      automation_runs: raw.usage.automation_runs,
      domains: raw.usage.domains,
      contacts: raw.usage.contacts,
    } : { available: false },
  };
}

async function auditAccount() {
  const [domains, apiKeys, automations, templates, contacts, webhooks, suppressions, usage, events] = await Promise.all([
    resend("/domains"),
    resend("/api-keys"),
    resend("/automations"),
    resend("/templates?limit=100"),
    resend("/contacts?limit=100"),
    resend("/webhooks"),
    resend("/suppressions?limit=100"),
    optional("/usage"),
    resend("/events"),
  ]);
  const raw = { domains, apiKeys, automations, templates, contacts, webhooks, suppressions, usage, events };
  const safe = safeAudit(raw);
  await mkdir(join(root, "dist", "resend"), { recursive: true });
  await writeFile(join(root, "dist", "resend", "account-audit.json"), `${JSON.stringify(safe, null, 2)}\n`, "utf8");
  console.log(`Resend audit: ${safe.counts.domains} domain(s), ${safe.counts.templates} template(s), ${safe.counts.automations} automation(s), ${safe.counts.webhooks} webhook(s).`);
  return { raw, safe };
}

function senderDomain(value) {
  const address = value.match(/<([^>]+)>/)?.[1] ?? value;
  return address.split("@")[1]?.toLowerCase() ?? "";
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function sameJson(a, b) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

async function upsertEvents(definitions, existingItems) {
  const existing = new Map(existingItems.map(item => [item.name, item]));
  const resources = [];
  for (const definition of definitions) {
    const found = existing.get(definition.name);
    let result;
    if (found) {
      if (!sameJson(found.schema ?? {}, definition.schema)) {
        result = await resend(`/events/${encodeURIComponent(definition.name)}`, { method: "PATCH", body: { schema: definition.schema } });
      } else {
        result = found;
      }
    } else {
      result = await resend("/events", { method: "POST", body: definition });
    }
    resources.push({ resourceType: "EVENT", name: definition.name, externalId: result.id ?? found?.id ?? definition.name, status: "ACTIVE" });
  }
  return resources;
}

async function upsertTemplates(manifest, existingItems) {
  const existing = new Map(existingItems.filter(item => item.alias).map(item => [item.alias, item]));
  const resources = [];
  for (const template of manifest.templates) {
    const payload = {
      name: template.name,
      alias: template.alias,
      from,
      subject: template.subject,
      html: template.html,
      text: template.text,
      variables: template.variables,
    };
    const found = existing.get(template.alias);
    const result = found
      ? await resend(`/templates/${encodeURIComponent(found.id)}`, { method: "PATCH", body: payload })
      : await resend("/templates", { method: "POST", body: payload });
    const id = result.id ?? found?.id;
    if (!id) throw new Error(`template_id_missing:${template.alias}`);
    await resend(`/templates/${encodeURIComponent(id)}/publish`, { method: "POST" });
    resources.push({
      resourceType: "TEMPLATE",
      name: template.alias,
      externalId: id,
      status: "PUBLISHED",
      metadata: { flow: template.flow, email_number: template.email_number, source_document_id: template.source_document_id },
    });
  }
  return resources;
}

function automationGraph(value) {
  return value.workflow ?? value;
}

async function upsertDisabledAutomations(blueprints, existingItems, templateManifest) {
  const existing = new Map(existingItems.map(item => [item.name, item]));
  const subjects = new Map(templateManifest.templates.map(template => [template.alias, template.subject]));
  const resources = [];
  for (const source of blueprints) {
    const workflow = toResendWorkflow(source, from, replyTo, subjects);
    const payload = { name: source.name, status: "disabled", workflow };
    const found = existing.get(payload.name);
    let id;
    if (found) {
      if (found.status !== "disabled") throw new Error(`existing_automation_not_disabled:${payload.name}`);
      const detail = await resend(`/automations/${encodeURIComponent(found.id)}`);
      if (!sameJson(automationGraph(detail), automationGraph(payload))) {
        throw new Error(`existing_automation_graph_differs:${payload.name}`);
      }
      id = found.id;
    } else {
      const result = await resend("/automations", { method: "POST", body: payload });
      id = result.id;
    }
    if (!id) throw new Error(`automation_id_missing:${payload.name}`);
    resources.push({ resourceType: "AUTOMATION", name: payload.name, externalId: id, status: "DISABLED" });
  }
  return resources;
}

async function registerWithWorker(resources) {
  if (!workerUrl || !adminToken) return false;
  const response = await fetch(`${workerUrl}/api/lifecycle/admin/resources`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ resources }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`worker_resource_registration_failed:${response.status}`);
  return true;
}

const manifest = JSON.parse(await readFile(join(root, "dist", "templates", "manifest.json"), "utf8"));
const eventDefinitions = JSON.parse(await readFile(join(root, "dist", "resend", "events.json"), "utf8"));
const automationFile = JSON.parse(await readFile(join(root, "dist", "resend", "automations.json"), "utf8"));
if (manifest.count !== 39 || automationFile.count !== 6) throw new Error("provisioning_manifest_incomplete");

const audit = await auditAccount();
if (!apply) {
  console.log("Audit-only mode complete. No Resend resources were changed.");
  process.exit(0);
}

const domain = senderDomain(from);
const verified = dataList(audit.raw.domains).some(item => item.name?.toLowerCase() === domain && item.status === "verified");
if (!verified) throw new Error(`sender_domain_not_verified:${domain}`);

const resources = [];
resources.push(...await upsertEvents(eventDefinitions, dataList(audit.raw.events)));
resources.push(...await upsertTemplates(manifest, dataList(audit.raw.templates)));
resources.push(...await upsertDisabledAutomations(automationFile.automations, dataList(audit.raw.automations), manifest));
const registered = await registerWithWorker(resources);
await writeFile(
  join(root, "dist", "resend", "provision-result.json"),
  `${JSON.stringify({ completed_at: new Date().toISOString(), templates: 39, events: eventDefinitions.length, automations: 6, all_automations_disabled: true, worker_registered: registered }, null, 2)}\n`,
  "utf8",
);
console.log(`Provisioned ${eventDefinitions.length} events, 39 published templates, and 6 disabled automations. Worker registration: ${registered ? "complete" : "not configured"}.`);
