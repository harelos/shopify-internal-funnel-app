import { createHash, timingSafeEqual } from "node:crypto";

export function publicQaEnabled(): boolean {
  return process.env.BOT_PUBLIC_QA_MODE === "true";
}

export function configuredPublicQaToken(): string {
  return String(process.env.BOT_PUBLIC_QA_TOKEN || "").trim();
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function verifyPublicQaToken(value: unknown): boolean {
  if (!publicQaEnabled()) return false;
  const expected = configuredPublicQaToken();
  const supplied = String(value || "").trim();
  if (!expected || !supplied) return false;
  return timingSafeEqual(digest(expected), digest(supplied));
}

export function publicQaReadOnlyTool(name: string): boolean {
  return new Set([
    "product.read",
    "policy.read",
    "shipping.read",
    "recommendation.build",
    "order.read_scoped",
    "tracking.read_scoped",
    "customer.summary_scoped",
  ]).has(name);
}
