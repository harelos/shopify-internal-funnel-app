import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import funnelRoutes from "./routes/funnels.js";
import stepRoutes from "./routes/steps.js";
import variantRoutes from "./routes/variants.js";
import analyticsRoutes from "./routes/analytics.js";
import popupAnalyticsRoutes from "./routes/popup-analytics.js";
import growthCockpitRoutes from "./routes/growth-cockpit.js";
import journeyRoutes from "./routes/journeys.js";
import operationsRoutes from "./routes/operations.js";
import { shipmentAdminRouter, shipmentBridgeRouter } from "./routes/shipment-control.js";
import proxyRoutes from "./routes/proxy.js";
import authRoutes from "./routes/auth.js";
import shopifyRoutes from "./routes/shopify.js";
import shopifyIngestRoutes from "./routes/shopify-ingest.js";
import { aiConciergeStorefront, aiConciergeAdmin } from "./routes/ai-concierge.js";
import { cartOfferAdmin, cartOfferStorefront } from "./routes/cart-offers.js";
import { elementAdminRouter, elementRuntimeRouter } from "./routes/element-experiments.js";
import { pageExperimentAdminRouter, pageExperimentRuntimeRouter } from "./routes/page-experiments.js";
import { supportAdminRouter, supportBridgeRouter } from "./routes/support-desk.js";
import { requireShopifySession } from "./middleware/shopify-auth.js";
import trackPageRoutes from "./routes/track-page.js";
import storefrontVisitRoutes from "./routes/storefront-visit.js";
import { workerEnvValue } from "./lib/shopify-config.js";
import { seedDemoFunnelIfNeeded } from "./services/seed.js";

const isWorkerRuntime = process.env.RUNTIME === "cloudflare" || Boolean(
  (globalThis as typeof globalThis & { __SHOPIFY_WORKER_ENV__?: unknown }).__SHOPIFY_WORKER_ENV__,
);
const __dirname = isWorkerRuntime ? "/" : path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use("/webhooks/shopify", express.raw({ type: "application/json", limit: "2mb" }));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// Allow iframe embedding inside Shopify Admin
app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", "frame-ancestors https://*.myshopify.com https://admin.shopify.com;");
  res.removeHeader("X-Frame-Options");
  next();
});

const adminRoot = path.join(__dirname, "../public/admin");

type WorkerAssets = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

function getWorkerAssets(): WorkerAssets | undefined {
  return (globalThis as typeof globalThis & {
    __SHOPIFY_WORKER_ENV__?: { ASSETS?: WorkerAssets };
  }).__SHOPIFY_WORKER_ENV__?.ASSETS;
}

function assetRequest(req: express.Request): Request {
  return new Request(new URL(req.originalUrl || req.url, "https://assets.local"));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] as string);
}

// Injects only the public client ID into App Bridge's required meta tag.
// Secrets are never sent to the browser.
async function serveAdminHtml(req: express.Request, res: express.Response, next: express.NextFunction) {
  const relativePath = req.path === "/" ? "index.html" : req.path.replace(/^\/+/, "");
  if (!relativePath.endsWith(".html") || relativePath.includes("..")) return next();

  const assets = getWorkerAssets();
  if (assets) {
    const response = await assets.fetch(assetRequest(req));
    if (!response.ok) return next();
    const html = (await response.text()).replaceAll(
      "%SHOPIFY_API_KEY%",
      escapeHtml(workerEnvValue("SHOPIFY_CLIENT_ID") || workerEnvValue("SHOPIFY_API_KEY")),
    );
    res.type("html").send(html);
    return;
  }

  const filePath = path.resolve(adminRoot, relativePath);
  if (!filePath.startsWith(path.resolve(adminRoot) + path.sep) || !fs.existsSync(filePath)) return next();

  const html = fs.readFileSync(filePath, "utf8")
    .replaceAll("%SHOPIFY_API_KEY%", escapeHtml(workerEnvValue("SHOPIFY_CLIENT_ID") || workerEnvValue("SHOPIFY_API_KEY")));
  res.type("html").send(html);
}

async function serveWorkerAsset(req: express.Request, res: express.Response, next: express.NextFunction) {
  const assets = getWorkerAssets();
  if (!assets) return next();
  const response = await assets.fetch(assetRequest(req));
  if (response.status === 404) return next();
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.status(response.status).send(Buffer.from(await response.arrayBuffer()));
}

// Serve admin UI static files. The HTML middleware keeps App Bridge usable in
// Shopify while leaving the local preview fully functional with an empty key.
app.use("/admin", serveAdminHtml, serveWorkerAsset, express.static(adminRoot));

// Serve standalone preview static files
app.use("/preview", serveWorkerAsset, express.static(path.join(__dirname, "../preview")));

// Mount OAuth routes
app.use("/", authRoutes);

// The local Namecheap mailbox bridge and agent API use a dedicated bearer
// token. Keep this outside Shopify Admin session middleware so the background
// service can sync and deliver mail without a browser session.
app.use("/support-bridge", supportBridgeRouter);
app.use("/shipment-bridge", shipmentBridgeRouter);

import novahairRoutes from "./routes/novahair.js";

// Storefront element experiments must be mounted before the generic funnel
// proxy so /apps/funnels/element-runtime/... is not interpreted as a slug.
app.use("/apps/funnels", pageExperimentRuntimeRouter);
app.use("/apps/funnels", elementRuntimeRouter);
// The storefront "where is my package" page. The guard belongs to the route
// itself, not to this mount: attached here it also saw /apps/funnels/api/...
// as its own sub-path, which is not on the storefront allowlist, so every
// popup, concierge and cart-offer call from the storefront was rejected.
app.use("/apps/funnels", trackPageRoutes);

// Mount ingest and order routes before the storefront proxy surface.
app.use("/", shopifyIngestRoutes);
app.use("/", novahairRoutes);

// Shopify forwards storefront popup telemetry to this exact App Proxy path.
// The middleware accepts only Shopify-signed proxy requests here.
app.use("/apps/funnels/api", requireShopifySession, popupAnalyticsRoutes);
// Storefront page views, so a buyer counts as a tracked visitor.
app.use("/apps/funnels/api", requireShopifySession, storefrontVisitRoutes);

// AI concierge free-text turns. Storefront-facing (proxy-signed) so shoppers
// can reach it. The admin-only /ai-steps analytics is mounted separately below.
app.use("/apps/funnels/api", requireShopifySession, aiConciergeStorefront);
app.use("/apps/funnels/api", requireShopifySession, cartOfferStorefront);

// Generic funnel routes include /apps/funnels/:slug/:step. Keep them after
// the explicit API mount or a GET such as /api/proxy-health is interpreted as
// a funnel named "api" and never reaches its authenticated handler.
app.use("/", proxyRoutes);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// What is live. The deploy guard stamps these at deploy time; if they read
// "unknown", the Worker was deployed around the guard.
app.get("/api/version", (_req, res) => {
  res.json({
    sha: workerEnvValue("BUILD_SHA") || "unknown",
    branch: workerEnvValue("BUILD_BRANCH") || "unknown",
    builtAt: workerEnvValue("BUILD_TIME") || "unknown",
    deployedFrom: workerEnvValue("BUILD_FROM") || "unknown",
  });
});

// All admin API routes are protected in hosted mode. Local preview remains
// usable until SHOPIFY_REQUIRE_AUTH=true is explicitly set.
app.use("/api", requireShopifySession);
app.use("/api", supportAdminRouter);
app.use("/api", elementAdminRouter);
app.use("/api", pageExperimentAdminRouter);
app.use("/api", funnelRoutes);
app.use("/api", stepRoutes);
app.use("/api", variantRoutes);
app.use("/api", popupAnalyticsRoutes);
app.use("/api", growthCockpitRoutes);
app.use("/api", analyticsRoutes);
app.use("/api", journeyRoutes);
app.use("/api", operationsRoutes);
app.use("/api", shipmentAdminRouter);
app.use("/api", shopifyRoutes);
// Admin-only: per-step AI funnel with shopper free text. Never on the proxy path.
app.use("/api", aiConciergeAdmin);
app.use("/api", cartOfferAdmin);

// Error handler
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // The stack names internal paths and module structure. It belongs in the
  // Worker log, which only the owner can read, never in a response that an
  // unauthenticated storefront caller can trigger.
  console.error("[EXPRESS UNCAUGHT ERROR]", req.method, req.path, err);
  res.status(500).json({ ok: false, error: "The request could not be completed." });
});

export default app;

if (process.env.RUNTIME !== "cloudflare") {
  const port = Number(process.env.PORT ?? process.env.APP_PORT ?? 3000);
  app.listen(port, async () => {
    console.log(`\n  Shopify Funnel Builder running at http://localhost:${port}/admin/\n`);
    // Demo data is destructive during a partial seed, so it must be explicitly
    // enabled. A hosted app never seeds or deletes owner data on startup.
    if (process.env.ENABLE_DEMO_SEED === "true") {
      await seedDemoFunnelIfNeeded();
    }
  });
}
