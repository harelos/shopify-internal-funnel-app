import type { ClickFlow, LifecycleFlow } from "./types";

export interface LifecycleUtm {
  source: "resend";
  medium: "email";
  campaign: string;
  content: string;
}

export function campaignForFlow(flow: ClickFlow): string {
  return `novahair_${flow}`;
}

/**
 * `campaignOverride` lets a one-off campaign carry its own utm_campaign
 * (`novahair_campaign_<slug>`) instead of the generic per-flow value, so each
 * newsletter shows up separately in analytics. Flows pass nothing and keep the
 * value `campaignForFlow` has always produced.
 */
export function appendLifecycleUtm(
  target: string,
  flow: ClickFlow,
  content: string,
  campaignOverride?: string,
): {
  url: string;
  utm: LifecycleUtm;
} {
  const parsed = new URL(target);
  if (!["https:", "http:"].includes(parsed.protocol)) throw new Error("unsupported_target_protocol");
  const override = campaignOverride?.trim();
  const utm: LifecycleUtm = {
    source: "resend",
    medium: "email",
    campaign: override && /^[A-Za-z0-9_-]{1,120}$/.test(override) ? override : campaignForFlow(flow),
    content,
  };
  parsed.searchParams.set("utm_source", utm.source);
  parsed.searchParams.set("utm_medium", utm.medium);
  parsed.searchParams.set("utm_campaign", utm.campaign);
  parsed.searchParams.set("utm_content", utm.content);
  return { url: parsed.toString(), utm };
}

export function assertRecoveryIdentityPreserved(before: string, after: string): void {
  const original = new URL(before);
  const attributed = new URL(after);
  if (
    original.protocol !== attributed.protocol
    || original.host !== attributed.host
    || original.pathname !== attributed.pathname
    || original.hash !== attributed.hash
  ) {
    throw new Error("recovery_url_identity_changed");
  }
  const originalEntries: Array<[string, string]> = [];
  original.searchParams.forEach((value, key) => originalEntries.push([key, value]));
  for (const [key, value] of originalEntries) {
    if (attributed.searchParams.getAll(key).filter(candidate => candidate === value).length
      < original.searchParams.getAll(key).filter(candidate => candidate === value).length) {
      throw new Error(`recovery_url_parameter_changed:${key}`);
    }
  }
}

export function safeStorefrontUrl(storefrontDomain: string, path = "/"): string {
  const host = storefrontDomain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!/^[a-z0-9.-]+$/.test(host)) throw new Error("invalid_storefront_domain");
  return new URL(path, `https://${host}`).toString();
}
