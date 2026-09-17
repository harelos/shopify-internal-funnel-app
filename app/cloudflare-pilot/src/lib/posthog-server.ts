import { workerEnvValue } from "./shopify-config.js";

export async function capturePostHogServerEvent(
  event: string,
  distinctId: string,
  properties: Record<string, string | number | boolean | null>,
): Promise<boolean> {
  const apiKey = workerEnvValue("POSTHOG_PROJECT_API_KEY");
  if (!apiKey || !event || !distinctId) return false;
  const host = (workerEnvValue("POSTHOG_HOST") || "https://us.i.posthog.com").replace(/\/$/, "");
  try {
    const response = await fetch(`${host}/i/v0/e/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, event, properties: { distinct_id: distinctId, ...properties } }),
      signal: AbortSignal.timeout(3500),
    });
    return response.ok;
  } catch {
    return false;
  }
}
