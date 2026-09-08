export function normalizeShopifyCartToken(value: unknown): string {
  const token = String(value ?? "").trim().split("?", 1)[0];
  return /^[a-zA-Z0-9_-]{8,200}$/.test(token) ? token : "";
}
