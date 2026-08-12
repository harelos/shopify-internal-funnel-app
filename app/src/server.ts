import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { buildFunnelReport, reportToCsv, reportToJson, type ReportFilters } from "./analytics.js";
import { FunnelService } from "./funnel-service.js";
import { seedExampleFunnel } from "./example-funnel.js";
import { renderSandboxDocument } from "./portability.js";
import { normalizePaidOrderWebhook, normalizeShopifyPixelEvent, type FunnelContext, type ShopifyPixelEventInput } from "./shopify-integration.js";
import { shopifyBoundary } from "./shopify-boundary.js";
import type { DeviceClass, EventSource, StepKind, SyntheticEventInput } from "./types.js";

const app = new FunnelService();
const shop = app.createShop(process.env.ALLOWED_SHOP_DOMAIN ?? "local-only.myshopify.test");
const demo = seedExampleFunnel(app, shop);

function send(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}
function sendHtml(response: ServerResponse, status: number, html: string, headers: Record<string, string> = {}): void {
  response.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...headers });
  response.end(html);
}
function sendText(response: ServerResponse, status: number, payload: string, contentType: string): void {
  response.writeHead(status, { "Content-Type": contentType, "Cache-Control": "no-store" });
  response.end(payload);
}
async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const text = await rawBody(request);
  if (!text) return {};
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON object body is required.");
  return parsed as Record<string, unknown>;
}
async function rawBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 512 * 1024) throw new Error("Request body is too large.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
function text(value: unknown): string { return typeof value === "string" ? value : ""; }
function escapeHtml(value: string): string { return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!); }
function optionalDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date filter: ${value}`);
  return date;
}
function reportFilters(url: URL): ReportFilters {
  return {
    dataMode: url.searchParams.get("dataMode") === "LIVE" ? "LIVE" : "TEST",
    from: optionalDate(url.searchParams.get("from")),
    to: optionalDate(url.searchParams.get("to")),
    stepId: url.searchParams.get("stepId") || undefined,
    variantId: url.searchParams.get("variantId") || undefined,
    source: (url.searchParams.get("source") || undefined) as EventSource | undefined,
    utmSource: url.searchParams.get("utmSource") || undefined,
    utmMedium: url.searchParams.get("utmMedium") || undefined,
    utmCampaign: url.searchParams.get("utmCampaign") || undefined,
    deviceClass: (url.searchParams.get("deviceClass") || undefined) as DeviceClass | undefined,
  };
}
function localShopifyAdaptersEnabled(): boolean { return process.env.ENABLE_LOCAL_SHOPIFY_ADAPTERS === "true"; }
function dashboard(): string {
  const funnelRows = app.listFunnels(shop.id).map((funnel) => {
    const steps = app.store.stepsForFunnel(funnel.id);
    return `<tr><td><b>${escapeHtml(funnel.name)}</b><small>${escapeHtml(funnel.slug)}</small></td><td>${funnel.status}</td><td>${steps.length}</td><td><button data-archive="${funnel.id}">Archive</button></td></tr>`;
  }).join("") || "<tr><td colspan=4>No local funnels yet.</td></tr>";
  const demoVersion = app.store.versionsForVariant(demo.presell.advertorial.id)[0];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Funnel Control — local slice</title><style>
    :root{--paper:#f5f1e8;--ink:#17231e;--line:#d6d1c6;--orange:#d85336;--green:#197b5b}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:14px Arial,sans-serif}main{max-width:1050px;margin:auto;padding:28px}header{border-bottom:1px solid var(--ink);padding-bottom:18px;margin-bottom:18px}h1{margin:5px 0;font-size:28px}h2{font-size:15px;margin:0}.eyebrow,small,code{font:11px ui-monospace,Consolas,monospace;color:#66716a}.notice{border-left:4px solid #b88a18;background:#fbf0c9;padding:11px;margin:16px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.panel{border:1px solid var(--ink);background:#fffdf8;margin-bottom:16px}.panel h2{padding:11px 13px;border-bottom:1px solid var(--ink)}.body{padding:13px}label{display:block;font:11px ui-monospace,Consolas,monospace;margin:10px 0 4px}input,select,textarea{width:100%;padding:8px;border:1px solid var(--ink);background:#fffdf8}textarea{min-height:110px;font:12px ui-monospace,Consolas,monospace}button{border:1px solid var(--ink);background:#fffdf8;padding:8px 11px;font-weight:bold;cursor:pointer;margin-top:10px}button.primary{background:var(--orange);border-color:var(--orange);color:#fff}table{width:100%;border-collapse:collapse}td,th{padding:10px;border-bottom:1px solid var(--line);text-align:left}tr:last-child td{border:0}td small{display:block}iframe{width:100%;height:170px;border:1px dashed #7d8178;background:#fff}#result{white-space:pre-wrap;font:12px ui-monospace,Consolas,monospace;color:#28463b}.tag{font:11px ui-monospace,Consolas,monospace;color:var(--green)}@media(max-width:680px){main{padding:16px}.grid{grid-template-columns:1fr}}
  </style></head><body><main><header><div class="eyebrow">PRIVATE LOCAL-ONLY SCAFFOLD · SYNTHETIC DATA</div><h1>Funnel Control</h1><p>This dashboard runs without Shopify credentials. ${escapeHtml(shopifyBoundary.checkoutBoundary)}</p></header><div class="notice"><b>Shopify Basic boundary:</b> this local slice may record a synthetic checkout start and paid order; it does not change or A/B-test checkout.</div><section class="panel"><h2>Example funnel flow</h2><div class="body"><h3>${escapeHtml(demo.funnel.name)}</h3><ol>${app.store.stepsForFunnel(demo.funnel.id).map((step) => `<li><b>${escapeHtml(step.name)}</b> <span class="tag">${step.kind}</span></li>`).join("")}</ol><p class="tag">Experiment 1: Advertorial vs. 7 Reasons Listicle · Experiment 2: Story &amp; Proof vs. Offer &amp; Value · Checkout: native Shopify handoff.</p><p><a href="/preview-static/" target="_blank">Open static browser preview</a></p></div></section><div class="grid"><section class="panel"><h2>Create or rename a funnel</h2><div class="body"><form id="funnel-form"><label>Name<input name="name" value="Second local funnel" required></label><label>Slug<input name="slug" value="second-local-funnel" required></label><button class="primary">Create funnel</button></form><form id="rename-form"><label>Rename example funnel<input name="name" value="Example: Custom Matchday Shirt" required></label><button>Save name</button></form><div id="result"></div></div></section><section class="panel"><h2>HTML import / safe preview</h2><div class="body"><form id="import-form"><input type="hidden" name="variantId" value="${demo.presell.advertorial.id}"><label>Complete HTML source<textarea name="html"><!doctype html><html><head><script>alert('blocked')</script></head><body><main><h1>Imported local page</h1><button onclick="alert('blocked')">Continue</button></main></body></html></textarea></label><button class="primary">Import into local draft</button></form><p class="tag">Existing draft preview (scripts disabled):</p>${demoVersion ? `<iframe sandbox="" src="/preview/${demoVersion.id}" title="Safe imported HTML preview"></iframe>` : ""}</div></section></div><section class="panel"><h2>Current funnels</h2><table><thead><tr><th>Name</th><th>Status</th><th>Steps</th><th>Update</th></tr></thead><tbody id="funnels">${funnelRows}</tbody></table></section><section class="panel"><h2>Local analytics and report export</h2><div class="body"><p><b>TEST data only.</b> Checkout starts are observed signals; paid orders/revenue are synthetic webhook stand-ins.</p><button id="analytics">Refresh analytics</button><button id="csv">Download CSV report</button><button id="json">Download JSON report</button><pre id="analytics-result" class="tag"></pre></div></section><section class="panel"><h2>Synthetic event tools</h2><div class="body"><button id="events">Record entry → CTA → checkout → paid order</button><p id="event-result" class="tag"></p></div></section></main><script>
  const api=(path,method='GET',payload)=>fetch(path,{method,headers:{'Content-Type':'application/json'},body:payload?JSON.stringify(payload):undefined}).then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.error);return data});
  document.querySelector('#funnel-form').addEventListener('submit',async(e)=>{e.preventDefault();const f=new FormData(e.currentTarget);try{const result=await api('/api/funnels','POST',{name:f.get('name'),slug:f.get('slug')});document.querySelector('#result').textContent='Created '+result.name+'. Reload to read it in the table.'}catch(error){document.querySelector('#result').textContent=error.message}});
  document.querySelector('#rename-form').addEventListener('submit',async(e)=>{e.preventDefault();const f=new FormData(e.currentTarget);try{const result=await api('/api/funnels/${demo.funnel.id}','PATCH',{name:f.get('name')});document.querySelector('#result').textContent='Renamed to '+result.name+'. Reload to update the table.'}catch(error){document.querySelector('#result').textContent=error.message}});
  document.querySelector('#import-form').addEventListener('submit',async(e)=>{e.preventDefault();const f=new FormData(e.currentTarget);try{const result=await api('/api/import','POST',{variantId:f.get('variantId'),html:f.get('html')});document.querySelector('#result').textContent='Draft r'+result.revision+' created; scripts removed: '+result.portabilityReport.scriptsRemoved+'.'}catch(error){document.querySelector('#result').textContent=error.message}});
  document.querySelector('#events').addEventListener('click',async()=>{try{const base={shopId:'${shop.id}',visitorId:'local-visitor-1',funnelId:'${demo.funnel.id}',stepId:'${demo.presell.step.id}',variantId:'${demo.presell.advertorial.id}'};await api('/api/events','POST',{...base,eventKey:'entry-local-1',name:'FUNNEL_STEP_ENTERED'});await api('/api/events','POST',{...base,eventKey:'cta-local-1',name:'FUNNEL_CTA_CLICKED'});await api('/api/events','POST',{...base,eventKey:'checkout-local-1',name:'CART_CHECKOUT_STARTED',checkoutToken:'checkout-local-1'});const paid=await api('/api/events','POST',{...base,eventKey:'paid-local-1',name:'SHOPIFY_ORDER_PAID',checkoutToken:'checkout-local-1',orderGid:'gid://shopify/Order/local-1',currency:'USD',grossAmount:99});document.querySelector('#event-result').textContent='Synthetic paid order attributed: $'+paid.orderAttribution.netRevenueAmount+' '+paid.orderAttribution.currency+'. Replays are idempotent.'}catch(error){document.querySelector('#event-result').textContent=error.message}});
  document.querySelector('#analytics').addEventListener('click',async()=>{const report=await api('/api/analytics?funnelId=${demo.funnel.id}');document.querySelector('#analytics-result').textContent='Entries: '+report.uniqueStepEntries+' · CTA: '+report.ctaClicks+' · observed checkout starts: '+report.checkoutStartsObserved+' · confirmed paid: '+report.paidOrdersConfirmed+' · revenue: $'+report.attributedRevenue+' · AOV: '+(report.aov??'—')});
  document.querySelector('#csv').addEventListener('click',()=>location.assign('/api/reports/funnel/${demo.funnel.id}?format=csv'));
  document.querySelector('#json').addEventListener('click',()=>location.assign('/api/reports/funnel/${demo.funnel.id}?format=json'));
  document.querySelectorAll('[data-archive]').forEach(button=>button.addEventListener('click',async()=>{await api('/api/funnels/'+button.dataset.archive,'PATCH',{status:'ARCHIVED'});location.reload()}));
  </script></body></html>`;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/") return sendHtml(response, 200, dashboard());
    if (request.method === "GET" && (url.pathname === "/preview-static" || url.pathname === "/preview-static/")) {
      const staticPreview = await readFile(new URL("../../preview/index.html", import.meta.url), "utf8");
      return sendHtml(response, 200, staticPreview);
    }
    if (request.method === "GET" && url.pathname.startsWith("/preview/")) {
      const version = app.store.versions.get(url.pathname.split("/").at(-1) ?? "");
      if (!version) return sendHtml(response, 404, "Not found");
      return sendHtml(response, 200, renderSandboxDocument(version.normalizedHtml), { "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:" });
    }
    if (request.method === "GET" && url.pathname === "/api/funnels") return send(response, 200, app.listFunnels(shop.id));
    const getFunnelMatch = url.pathname.match(/^\/api\/funnels\/([^/]+)$/);
    if (request.method === "GET" && getFunnelMatch) {
      const funnel = app.getFunnel(getFunnelMatch[1]!);
      return send(response, 200, { funnel, steps: app.store.stepsForFunnel(funnel.id).map((step) => ({ step, variants: app.store.variantsForStep(step.id), experiment: app.store.values(app.store.experiments).find((item) => item.stepId === step.id) })) });
    }
    if (request.method === "GET" && url.pathname === "/api/analytics") return send(response, 200, buildFunnelReport(app.store, url.searchParams.get("funnelId") ?? demo.funnel.id, reportFilters(url)));
    const reportMatch = url.pathname.match(/^\/api\/reports\/funnel\/([^/]+)$/);
    if (request.method === "GET" && reportMatch) {
      const report = buildFunnelReport(app.store, reportMatch[1]!, reportFilters(url));
      if (url.searchParams.get("format") === "csv") return sendText(response, 200, reportToCsv(report), "text/csv; charset=utf-8");
      return sendText(response, 200, reportToJson(report), "application/json; charset=utf-8");
    }
    if (request.method === "POST" && url.pathname === "/api/funnels") { const input = await body(request); return send(response, 201, app.createFunnel(shop.id, text(input.name), text(input.slug))); }
    const stepMatch = url.pathname.match(/^\/api\/funnels\/([^/]+)\/steps$/);
    if (request.method === "POST" && stepMatch) { const input = await body(request); return send(response, 201, app.addStep(stepMatch[1]!, text(input.name), text(input.kind) as StepKind)); }
    const funnelMatch = url.pathname.match(/^\/api\/funnels\/([^/]+)$/);
    if (request.method === "PATCH" && funnelMatch) { const input = await body(request); return send(response, 200, app.updateFunnel(funnelMatch[1]!, { name: input.name === undefined ? undefined : text(input.name), status: input.status === undefined ? undefined : text(input.status) as "DRAFT" | "PUBLISHED" | "ARCHIVED" })); }
    if (request.method === "POST" && url.pathname === "/api/import") { const input = await body(request); return send(response, 201, app.importHtml(text(input.variantId), text(input.html))); }
    const versionMatch = url.pathname.match(/^\/api\/versions\/([^/]+)$/);
    if (request.method === "PATCH" && versionMatch) { const input = await body(request); return send(response, 200, app.updateDraftVersion(versionMatch[1]!, text(input.html))); }
    const publishMatch = url.pathname.match(/^\/api\/versions\/([^/]+)\/publish$/);
    if (request.method === "POST" && publishMatch) return send(response, 200, app.publishVersion(publishMatch[1]!));
    if (request.method === "POST" && url.pathname === "/api/assignments") { const input = await body(request); return send(response, 201, app.assignVariant(shop.id, text(input.visitorKey), text(input.experimentId))); }
    if (request.method === "POST" && url.pathname === "/api/integrations/shopify/pixel") {
      if (!localShopifyAdaptersEnabled()) return send(response, 403, { error: "Local Shopify adapters are disabled. Set ENABLE_LOCAL_SHOPIFY_ADAPTERS=true only for fixture testing." });
      const input = await body(request);
      const normalized = normalizeShopifyPixelEvent(input.event as ShopifyPixelEventInput, (input.context ?? {}) as FunnelContext);
      if (!normalized.accepted) return send(response, 422, { error: normalized.reason });
      if (normalized.value.shopDomain.toLowerCase() !== shop.domain.toLowerCase()) return send(response, 403, { error: "Shop domain is not allowlisted." });
      return send(response, 201, app.ingestShopifyIntegrationEvent(shop.id, normalized.value));
    }
    if (request.method === "POST" && url.pathname === "/api/integrations/shopify/webhooks/orders-paid") {
      if (!localShopifyAdaptersEnabled()) return send(response, 403, { error: "Local Shopify adapters are disabled. Set ENABLE_LOCAL_SHOPIFY_ADAPTERS=true only for fixture testing." });
      const raw = await rawBody(request);
      const normalized = normalizePaidOrderWebhook({
        rawBody: raw,
        hmacSha256: text(request.headers["x-shopify-hmac-sha256"]),
        topic: text(request.headers["x-shopify-topic"]),
        shopDomain: text(request.headers["x-shopify-shop-domain"]),
        expectedShopDomain: shop.domain,
        webhookSecret: process.env.SHOPIFY_WEBHOOK_SECRET ?? "",
      });
      if (!normalized.accepted) return send(response, 422, { error: normalized.reason });
      return send(response, 201, app.ingestShopifyIntegrationEvent(shop.id, normalized.value));
    }
    if (request.method === "POST" && url.pathname === "/api/events") return send(response, 201, app.ingestEvent((await body(request)) as unknown as SyntheticEventInput));
    return send(response, 404, { error: "Route not found." });
  } catch (error) { return send(response, 400, { error: error instanceof Error ? error.message : "Unknown error" }); }
});

const port = Number(process.env.APP_PORT ?? 3000);
server.listen(port, () => console.log(`Funnel Control local-only slice: http://localhost:${port}`));
