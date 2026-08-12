import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import funnelRoutes from "./routes/funnels.js";
import stepRoutes from "./routes/steps.js";
import variantRoutes from "./routes/variants.js";
import analyticsRoutes from "./routes/analytics.js";
import proxyRoutes from "./routes/proxy.js";
import { seedDemoFunnelIfNeeded } from "./services/seed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// Serve admin UI static files
app.use("/admin", express.static(path.join(__dirname, "../admin")));

// Serve standalone preview static files
app.use("/preview", express.static(path.join(__dirname, "../../preview")));

// Mount API routes
app.use("/api", funnelRoutes);
app.use("/api", stepRoutes);
app.use("/api", variantRoutes);
app.use("/api", analyticsRoutes);

// Mount Proxy / Preview routes
app.use("/", proxyRoutes);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Root redirect to Admin
app.get("/", (_req, res) => {
  res.redirect("/admin/");
});

export default app;

const port = Number(process.env.APP_PORT ?? 3000);
app.listen(port, async () => {
  console.log(`\n  Shopify Funnel Builder running at http://localhost:${port}/admin/\n`);
  await seedDemoFunnelIfNeeded();
});
