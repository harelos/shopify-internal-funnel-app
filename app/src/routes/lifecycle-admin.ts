import type { Response } from "express";
import { Router } from "express";

const router = Router();

type QueryValues = Record<string, string | string[] | undefined>;

function lifecycleIntegrationConfig() {
  const workerUrl = process.env.LIFECYCLE_WORKER_URL?.trim().replace(/\/$/, "");
  const adminToken = process.env.LIFECYCLE_ADMIN_TOKEN?.trim();

  return {
    workerUrl,
    adminToken,
  };
}

function buildUpstreamUrl(path: string, query: QueryValues) {
  const { workerUrl } = lifecycleIntegrationConfig();
  const url = new URL(path, `${workerUrl ? `${workerUrl}/` : ""}`);
  for (const [key, rawValue] of Object.entries(query)) {
    if (rawValue === undefined) continue;
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      const text = String(value ?? "").trim();
      if (text) url.searchParams.set(key, text);
    }
  }
  return url.toString();
}

function normalizeQuery(raw: Record<string, unknown>): QueryValues {
  const normalized: QueryValues = {};
  for (const [key, rawValue] of Object.entries(raw)) {
    if (Array.isArray(rawValue)) {
      const flattened = rawValue
        .filter(item => item !== undefined && item !== null)
        .map(item => String(item).trim())
        .filter((item) => item.length > 0);
      normalized[key] = flattened;
      continue;
    }

    if (typeof rawValue === "string" || rawValue === undefined) {
      normalized[key] = rawValue;
      continue;
    }

    normalized[key] = String(rawValue).trim();
  }
  return normalized;
}

async function proxyLifecycleAdminRoute(reqPath: string, query: QueryValues, res: Response) {
  const { workerUrl, adminToken } = lifecycleIntegrationConfig();

  if (!workerUrl || !adminToken) {
    return res.status(503).json({
      ok: false,
      error:
        "Lifecycle worker integration is not configured. Set LIFECYCLE_WORKER_URL and LIFECYCLE_ADMIN_TOKEN in server secrets.",
    });
  }

  const upstreamUrl = buildUpstreamUrl(reqPath, query);

  const upstreamRes = await fetch(upstreamUrl, {
    headers: {
      Authorization: `Bearer ${adminToken}`,
      Accept: "application/json",
    },
  });

  const payloadText = await upstreamRes.text();
  let payload: unknown;
  try {
    payload = JSON.parse(payloadText || "{}") as unknown;
  } catch {
    payload = { error: payloadText || upstreamRes.statusText };
  }

  res.status(upstreamRes.status).json(payload);
}

// GET /api/lifecycle/admin/flows
router.get("/lifecycle/admin/flows", (req, res) => {
  return proxyLifecycleAdminRoute("/api/lifecycle/admin/flows", normalizeQuery(req.query as Record<string, unknown>), res);
});

// GET /api/lifecycle/admin/analytics
router.get("/lifecycle/admin/analytics", (req, res) => {
  return proxyLifecycleAdminRoute("/api/lifecycle/admin/analytics", normalizeQuery(req.query as Record<string, unknown>), res);
});

// GET /api/lifecycle/admin/audience
// Recipient-level data stays behind this server-side proxy and its admin access controls.
router.get("/lifecycle/admin/audience", (req, res) => {
  return proxyLifecycleAdminRoute("/api/lifecycle/admin/audience", normalizeQuery(req.query as Record<string, unknown>), res);
});

// GET /api/lifecycle/admin/health
router.get("/lifecycle/admin/health", (req, res) => {
  return proxyLifecycleAdminRoute("/api/lifecycle/health", normalizeQuery(req.query as Record<string, unknown>), res);
});

export default router;
