import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const adminRoot = path.resolve(here, "../admin");
const storefrontRoot = path.resolve(here, "../storefront");
const port = Number(process.env.POPUP_PREVIEW_PORT || 4174);

const campaign = {
  key: "popup-draft-1",
  name: "NovaHair recommendation — staging",
  type: "product_finder",
  status: "DRAFT",
  experimentVersion: 1,
  trigger: { mode: "time", seconds: 20, scrollPct: 50, inactivitySeconds: 30, requireCartItems: false, desktopExitOnly: true },
  targeting: { includePaths: ["/products/*"], excludePaths: ["/cart"], productHandles: [], funnelIds: [], trafficSources: [], referrerContains: [], utmSources: [], visitorState: "any", cartMinSubtotal: null, cartMaxSubtotal: null, requireCartItems: false },
  frequency: { suppressAfterCloseMinutes: 1440, suppressAfterSubmitDays: 30, maxImpressionsPerSession: 1, maxImpressionsPerVisitorDay: 1 },
  safety: { visibleCloseButton: true, escClose: true, localImmediateClose: true, backdropClose: true, restoreFocus: true, cleanupBodyScroll: true, maxOpenMs: 300000 },
  variants: [
    { key: "control", name: "Control", weightBasisPoints: 5000, creative: { eyebrow: "TIGER BRANDS", title: "רוצה עזרה לבחור נכון?", body: "תצוגת סטייג'ינג בלבד — כאן נבדוק התאמה לפי הקשר בלי לחסום את החנות.", ctaLabel: "המשך", secondaryLabel: "לא עכשיו", imageUrl: "", direction: "rtl", formMode: "none" } },
    { key: "b", name: "B", weightBasisPoints: 5000, creative: { eyebrow: "TIGER BRANDS", title: "יש משהו שיכול להתאים לך", body: "תצוגת סטייג'ינג בלבד — וריאנט B נשאר sticky לאותו מבקר.", ctaLabel: "לבדיקה", secondaryLabel: "לא עכשיו", imageUrl: "", direction: "rtl", formMode: "none" } },
  ],
};

const runtime = { stagingEnabled: false, eventIngestEnabled: false, storefrontEnabled: false, killSwitch: true, boundary: "STAGING_ONLY" };

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}

function consumeJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (error) { reject(error); }
    });
    req.on("error", reject);
  });
}

function serveFile(res, filePath, root) {
  if (!filePath.startsWith(`${root}${path.sep}`) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return false;
  res.writeHead(200, { "Content-Type": contentType(filePath), "Cache-Control": "no-store" });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);

  if (req.method === "GET" && url.pathname === "/api/popups/status") return json(res, 200, runtime);
  if (req.method === "GET" && url.pathname === "/api/popups/config") return json(res, 200, { campaigns: [campaign], defaultCampaign: campaign, runtime });
  if (req.method === "GET" && url.pathname === "/api/popups/analytics") return json(res, 200, { campaignKey: campaign.key, totals: {}, variants: {}, runtime });
  if (req.method === "PUT" && url.pathname.startsWith("/api/popups/campaigns/")) {
    const body = await consumeJson(req).catch(() => campaign);
    return json(res, 200, { ok: true, campaign: body, runtime });
  }
  if (req.method === "POST" && url.pathname === "/api/popups/evaluate") {
    const body = await consumeJson(req).catch(() => ({}));
    const selected = body?.campaign?.variants?.[0] || campaign.variants[0];
    return json(res, 200, { result: { eligible: true, reason: "eligible", variant: selected, assignmentBucket: 2048 }, campaignKey: body?.campaign?.key || campaign.key, experimentVersion: 1, simulatorOnly: true, runtime });
  }

  if (url.pathname.startsWith("/popup-runtime/assets/")) {
    const relative = url.pathname.slice("/popup-runtime/assets/".length);
    const asset = path.resolve(storefrontRoot, relative);
    if (serveFile(res, asset, storefrontRoot)) return;
  }

  const requested = url.pathname === "/" ? "/popups.html" : url.pathname;
  const filePath = path.resolve(adminRoot, `.${requested}`);
  if (serveFile(res, filePath, adminRoot)) return;

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Popup UI preview server listening on http://127.0.0.1:${port}`);
});
