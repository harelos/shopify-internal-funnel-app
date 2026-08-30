import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const adminRoot = path.resolve(here, "../admin");
const port = Number(process.env.BOT_PREVIEW_PORT || 4173);

const config = {
  version: 1,
  identity: {
    name: "Sara",
    label: "Digital sales assistant",
    welcome: "מה תרצי לדעת לפני שאת מחליטה?",
    placement: "all-funnels",
    avatarUrl: "",
    subtitle: "כאן כדי לעזור לבחור נכון",
    trustLine: "מידע על המוצר, משלוחים והזמנות במקום אחד",
  },
  routing: { support: true, retention: true, risk: true },
  playbook: {
    stages: "DISCOVER\nQUALIFY\nRECOMMEND\nOBJECTION\nOFFER\nCLOSE\nFOLLOW_UP",
    methods: "SPIN Selling\nCialdini / truthful influence principles\nGap Selling\nObjection handling",
  },
  offers: { firstPct: 5, secondPct: 10, maxPct: 10, firstMinMessages: 3, secondMinMessages: 5, marginFloorIls: null },
  models: [
    { provider: "openai", model: "sales-model-a", trafficPct: 50 },
    { provider: "gemini", model: "sales-model-b", trafficPct: 50 },
  ],
  crm: { progressive: true, email: true, phone: true },
  security: { messagesPer5m: 20, messagesPerHour: 80, maxUserChars: 2000 },
};

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
  if (req.method === "GET" && url.pathname === "/api/bot/config") return json(res, 200, { config, persisted: true, storefrontEnabled: false });
  if (req.method === "GET" && url.pathname === "/api/bot/providers/status") return json(res, 200, { providers: { openai: true, gemini: true, anthropic: false, xai: false, mock: true, pricingConfigured: true }, storefrontEnabled: false });
  if (req.method === "GET" && url.pathname === "/api/bot/knowledge") return json(res, 200, { packs: [], count: 0, storefrontEnabled: false });
  if (req.method === "GET" && url.pathname === "/api/bot/analytics") return json(res, 200, { conversations: 12, counters: { BOT_MESSAGE_USER: 31, BOT_MESSAGE_ASSISTANT: 31, bot_error: 0, bot_security_block: 1 }, models: {}, storefrontEnabled: false });

  const requested = url.pathname === "/" ? "/bot.html" : url.pathname;
  const filePath = path.resolve(adminRoot, `.${requested}`);
  if (!filePath.startsWith(`${adminRoot}${path.sep}`) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("Not found");
  }
  res.writeHead(200, { "Content-Type": contentType(filePath), "Cache-Control": "no-store" });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Bot UI preview server listening on http://127.0.0.1:${port}`);
});
