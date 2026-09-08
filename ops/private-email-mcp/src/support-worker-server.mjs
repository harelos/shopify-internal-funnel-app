import http from "node:http";
import { pathToFileURL } from "node:url";
import { runOnce } from "./support-sync.mjs";

const port = Number(process.env.PORT || 3000);
const intervalMs = Math.max(60000, Number(process.env.SUPPORT_SYNC_INTERVAL_MS || 120000));
const mailboxAddress = String(process.env.SUPPORT_MAILBOX_ADDRESS || process.env.NAMECHEAP_PRIVATE_EMAIL_USER || "").trim();

let stopping = false;
let running = false;
let timer = null;
let server = null;

const state = {
  status: "STARTING",
  startedAt: new Date().toISOString(),
  lastRunStartedAt: null,
  lastRunCompletedAt: null,
  lastResult: null,
  lastError: null,
};

function configured() {
  return Boolean(
    mailboxAddress
    && process.env.NAMECHEAP_PRIVATE_EMAIL_PASSWORD
    && process.env.SUPPORT_APP_URL
    && process.env.SUPPORT_CONNECTOR_TOKEN
  );
}

export function healthPayload() {
  return {
    ok: configured() && state.status !== "ERROR",
    service: "tiger-support-email-agent",
    status: state.status,
    mailboxConfigured: Boolean(mailboxAddress),
    sendEnabled: process.env.SUPPORT_MAIL_SEND_ENABLED === "true",
    intervalMs,
    ...state,
  };
}

function scheduleNext() {
  if (stopping) return;
  timer = setTimeout(runCycle, intervalMs);
  timer.unref?.();
}

export async function runCycle() {
  if (stopping || running) return;
  running = true;
  state.status = "RUNNING";
  state.lastRunStartedAt = new Date().toISOString();
  state.lastError = null;
  try {
    const result = await runOnce();
    state.status = "IDLE";
    state.lastResult = result.result;
    state.lastRunCompletedAt = new Date().toISOString();
    console.log(JSON.stringify({ event: "support_cycle_completed", ...healthPayload() }));
  } catch (error) {
    state.status = "ERROR";
    state.lastError = String(error?.message || error);
    state.lastRunCompletedAt = new Date().toISOString();
    console.error(JSON.stringify({ event: "support_cycle_failed", ...healthPayload() }));
  } finally {
    running = false;
    scheduleNext();
  }
}

function json(response, statusCode, value) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(value));
}

export function createHealthServer() {
  return http.createServer((request, response) => {
    if (request.method === "GET" && (request.url === "/" || request.url === "/health")) {
      const payload = healthPayload();
      return json(response, payload.ok ? 200 : 503, payload);
    }
    return json(response, 404, { ok: false });
  });
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  state.status = "STOPPING";
  if (timer) clearTimeout(timer);
  console.log(JSON.stringify({ event: "support_worker_stopping", signal }));
  if (server) await new Promise(resolve => server.close(resolve));
  process.exit(0);
}

export async function main() {
  server = createHealthServer();
  server.listen(port, "0.0.0.0", () => {
    console.log(JSON.stringify({ event: "support_worker_listening", port, configured: configured() }));
  });
  void runCycle();
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => void shutdown(signal));
}

const executedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (executedDirectly) {
  main().catch(error => {
    console.error(JSON.stringify({ event: "support_worker_start_failed", error: String(error?.message || error) }));
    process.exitCode = 1;
  });
}
