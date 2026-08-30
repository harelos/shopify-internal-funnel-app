import "dotenv/config";
import express from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import funnelRoutes from "./routes/funnels.js";
import stepRoutes from "./routes/steps.js";
import variantRoutes from "./routes/variants.js";
import analyticsRoutes from "./routes/analytics.js";
import commerceIntelligenceRoutes from "./routes/commerce-intelligence.js";
import profitOsRoutes from "./routes/profit-os.js";
import botRoutes from "./routes/bot.js";
import botRuntimeRoutes from "./routes/bot-runtime.js";
import publicBotQaRoutes from "./routes/public-bot-qa.js";
import proxyRoutes from "./routes/proxy.js";
import authRoutes from "./routes/auth.js";
import shopifyRoutes from "./routes/shopify.js";
import shopifyIngestRoutes from "./routes/shopify-ingest.js";
import { requireShopifySession } from "./middleware/shopify-auth.js";
import { seedDemoFunnelIfNeeded } from "./services/seed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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

const adminRoot = path.join(__dirname, "../admin");
const privateQaRoot = path.join(__dirname, "../private-qa");

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] as string);
}

function secureTextEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(String(left)).digest();
  const rightDigest = createHash("sha256").update(String(right)).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function privateQaCredentials(req: express.Request): { username: string; password: string } | null {
  const authorization = String(req.get("authorization") || "");
  if (!authorization.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(authorization.slice(6).trim(), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

// Dedicated isolated bot QA console. This route is intentionally outside the
// Shopify theme and outside /admin. It fails closed unless all QA secrets are
// configured server-side. The QA API token is injected only after Basic Auth.
app.get("/private-bot-qa/:slug", (req, res) => {
  const configuredSlug = String(process.env.BOT_QA_PAGE_SLUG || "").trim();
  if (!configuredSlug || !secureTextEqual(String(req.params.slug || ""), configuredSlug)) {
    return res.status(404).send("Not found.");
  }

  const expectedUsername = String(process.env.BOT_QA_PAGE_USER || "").trim();
  const expectedPassword = String(process.env.BOT_QA_PAGE_PASSWORD || "");
  const publicQaToken = String(process.env.BOT_PUBLIC_QA_TOKEN || "").trim();
  const pagePath = path.join(privateQaRoot, "bot.html");
  const configured = process.env.BOT_PUBLIC_QA_MODE === "true"
    && expectedUsername
    && expectedPassword
    && publicQaToken
    && fs.existsSync(pagePath);

  if (!configured) return res.status(503).send("Private QA is not configured.");

  const supplied = privateQaCredentials(req);
  if (!supplied || !secureTextEqual(supplied.username, expectedUsername) || !secureTextEqual(supplied.password, expectedPassword)) {
    res.setHeader("WWW-Authenticate", 'Basic realm="TIGER Bot QA", charset="UTF-8"');
    return res.status(401).send("Authentication required.");
  }

  const html = fs.readFileSync(pagePath, "utf8")
    .replaceAll("%BOT_PUBLIC_QA_TOKEN%", escapeHtml(publicQaToken));
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  return res.type("html").send(html);
});

// Injects only the public client ID into App Bridge's required meta tag.
// Secrets are never sent to the browser.
function serveAdminHtml(req: express.Request, res: express.Response, next: express.NextFunction) {
  const relativePath = req.path === "/" ? "index.html" : req.path.replace(/^\/+/, "");
  if (!relativePath.endsWith(".html") || relativePath.includes("..")) return next();

  const filePath = path.resolve(adminRoot, relativePath);
  if (!filePath.startsWith(path.resolve(adminRoot) + path.sep) || !fs.existsSync(filePath)) return next();

  const html = fs.readFileSync(filePath, "utf8")
    .replaceAll("%SHOPIFY_API_KEY%", escapeHtml(process.env.SHOPIFY_CLIENT_ID ?? process.env.SHOPIFY_API_KEY ?? ""));
  res.type("html").send(html);
}

// Serve admin UI static files. The HTML middleware keeps App Bridge usable in
// Shopify while leaving the local preview fully functional with an empty key.
app.use("/admin", serveAdminHtml, express.static(adminRoot));

// Serve standalone preview static files
app.use("/preview", express.static(path.join(__dirname, "../../preview")));

// Mount OAuth routes
app.use("/", authRoutes);

// Mount Proxy / Preview routes
app.use("/", proxyRoutes);
app.use("/", shopifyIngestRoutes);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Public QA is intentionally isolated from the embedded Shopify session layer.
// It is disabled unless BOT_PUBLIC_QA_MODE=true and requires its own secret token.
app.use("/qa/bot", publicBotQaRoutes);

// All admin API routes are protected in hosted mode. Local preview remains
// usable until SHOPIFY_REQUIRE_AUTH=true is explicitly set.
app.use("/api", requireShopifySession);
app.use("/api", funnelRoutes);
app.use("/api", stepRoutes);
app.use("/api", variantRoutes);
app.use("/api", analyticsRoutes);
app.use("/api", commerceIntelligenceRoutes);
app.use("/api", profitOsRoutes);
app.use("/api", botRoutes);
app.use("/api", botRuntimeRoutes);
app.use("/api", shopifyRoutes);

// Root redirect to Admin
app.get("/", (_req, res) => {
  res.redirect("/admin/");
});

export default app;

const port = Number(process.env.APP_PORT ?? 3000);
app.listen(port, async () => {
  console.log(`\n  Shopify Funnel Builder running at http://localhost:${port}/admin/\n`);
  // Demo data is destructive during a partial seed, so it must be explicitly
  // enabled. A hosted app never seeds or deletes owner data on startup.
  if (process.env.ENABLE_DEMO_SEED === "true") {
    await seedDemoFunnelIfNeeded();
  }
});
