import { workerEnvValue } from "./shopify-config.js";

/**
 * PostHog's private API (feature flags, experiments, HogQL), authenticated
 * with the personal key. The public project token in POSTHOG_PROJECT_API_KEY
 * can only send events; everything here reads or changes configuration, so it
 * needs the secret and is only ever called from admin routes.
 */

export class PostHogConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostHogConfigurationError";
  }
}

export interface PostHogFlagVariant {
  key: string;
  name?: string;
  rollout_percentage: number;
}

export interface PostHogFlag {
  id: number;
  key: string;
  name: string;
  active: boolean;
  filters: { multivariate?: { variants: PostHogFlagVariant[] }; groups?: unknown[] } & Record<string, unknown>;
}

export interface PostHogExperiment {
  id: number;
  name: string;
  description?: string;
  feature_flag_key: string;
  start_date: string | null;
  end_date: string | null;
  archived?: boolean;
  parameters?: Record<string, unknown>;
}

function config() {
  const apiKey = workerEnvValue("POSTHOG_PERSONAL_API_KEY");
  const projectId = workerEnvValue("POSTHOG_PROJECT_ID");
  const host = (workerEnvValue("POSTHOG_APP_HOST") || "https://us.posthog.com").replace(/\/$/, "");
  if (!apiKey || !projectId) {
    throw new PostHogConfigurationError("POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID are required to manage experiments.");
  }
  return { apiKey, projectId, host };
}

export function postHogConfigured(): boolean {
  return Boolean(workerEnvValue("POSTHOG_PERSONAL_API_KEY") && workerEnvValue("POSTHOG_PROJECT_ID"));
}

export function postHogAppUrl(pathname: string): string {
  const host = (workerEnvValue("POSTHOG_APP_HOST") || "https://us.posthog.com").replace(/\/$/, "");
  const projectId = workerEnvValue("POSTHOG_PROJECT_ID");
  return `${host}/project/${projectId}${pathname}`;
}

async function request<T>(pathname: string, init: RequestInit = {}): Promise<T> {
  const { apiKey, projectId, host } = config();
  const url = `${host}/api/projects/${projectId}${pathname}`;
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...(init.headers || {}) },
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    const detail = body && typeof body === "object" && "detail" in body ? String((body as { detail: unknown }).detail) : text.slice(0, 200);
    throw new Error(`PostHog ${init.method || "GET"} ${pathname} returned HTTP ${response.status}: ${detail}`);
  }
  return body as T;
}

export async function listExperiments(): Promise<PostHogExperiment[]> {
  const page = await request<{ results?: PostHogExperiment[] }>("/experiments/?limit=100");
  return (page.results || []).filter(experiment => !experiment.archived);
}

export async function getFlagByKey(key: string): Promise<PostHogFlag | null> {
  const page = await request<{ results?: PostHogFlag[] }>(`/feature_flags/?search=${encodeURIComponent(key)}&limit=50`);
  return (page.results || []).find(flag => flag.key === key) || null;
}

export async function updateFlag(id: number, patch: Partial<Pick<PostHogFlag, "active" | "filters">>): Promise<PostHogFlag> {
  return request<PostHogFlag>(`/feature_flags/${id}/`, { method: "PATCH", body: JSON.stringify(patch) });
}

export async function updateExperiment(id: number, patch: Record<string, unknown>): Promise<PostHogExperiment> {
  return request<PostHogExperiment>(`/experiments/${id}/`, { method: "PATCH", body: JSON.stringify(patch) });
}

export async function hogql<T extends unknown[] = unknown[]>(query: string): Promise<T[]> {
  const result = await request<{ results?: T[] }>("/query/", {
    method: "POST",
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
  });
  return result.results || [];
}
