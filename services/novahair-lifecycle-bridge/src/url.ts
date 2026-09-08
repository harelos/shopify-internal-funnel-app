import type { LifecycleFlow } from "./types";

export interface LifecycleUtm {
  source: "resend";
  medium: "email";
  campaign: string;
  content: string;
}

export function campaignForFlow(flow: LifecycleFlow): string {
  return `novahair_${flow}`;
}

export function appendLifecycleUtm(target: string, flow: LifecycleFlow, content: string): {
  url: string;
  utm: LifecycleUtm;
} {
  const parsed = new URL(target);
  if (!["https:", "http:"].includes(parsed.protocol)) throw new Error("unsupported_target_protocol");
  const utm: LifecycleUtm = {
    source: "resend",
    medium: "email",
    campaign: campaignForFlow(flow),
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
