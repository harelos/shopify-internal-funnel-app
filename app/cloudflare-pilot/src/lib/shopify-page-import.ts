import { analyzeHtml, type PortabilityReport } from "./portability.js";

export const DEFAULT_PAGE_IMPORT_MAX_BYTES = 5 * 1024 * 1024;

export class ShopifyPageImportError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ShopifyPageImportError";
    this.status = status;
  }
}

export interface PageImportOptions {
  shopDomain?: string;
  storefrontDomain?: string;
  allowedHosts?: string[];
  maxBytes?: number;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}

export interface ImportedShopifyPage {
  requestedUrl: string;
  finalUrl: string;
  title: string | null;
  html: string;
  normalizedHtml: string;
  report: PortabilityReport;
}

function normalizeHost(value: string | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split(":")[0];
}

function configuredHosts(options: PageImportOptions): Set<string> {
  return new Set([
    normalizeHost(options.shopDomain),
    normalizeHost(options.storefrontDomain),
    ...(options.allowedHosts ?? []).map(normalizeHost),
  ].filter(Boolean));
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function validateShopifyPageUrl(rawUrl: string, options: PageImportOptions = {}): URL {
  let url: URL;
  try {
    url = new URL(String(rawUrl ?? "").trim());
  } catch {
    throw new ShopifyPageImportError("Enter a valid Shopify page URL.");
  }

  const allowHttpLocalhost = isLocalHost(url.hostname);
  if (!(["https:", "http:"].includes(url.protocol) && (url.protocol === "https:" || allowHttpLocalhost))) {
    throw new ShopifyPageImportError("Only HTTPS Shopify page URLs are supported.");
  }
  if (url.username || url.password) {
    throw new ShopifyPageImportError("Page URLs cannot contain credentials.");
  }

  const hosts = configuredHosts(options);
  if (hosts.size === 0) {
    throw new ShopifyPageImportError("No approved storefront domain is configured for page import.", 503);
  }
  if (!hosts.has(normalizeHost(url.hostname)) && !(allowHttpLocalhost && hosts.has(normalizeHost(url.hostname)))) {
    throw new ShopifyPageImportError("The page URL must belong to the configured Shopify store.");
  }

  return url;
}

function pageTitle(html: string): string | null {
  const value = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1]
    ?.replace(/\s+/g, " ")
    .trim();
  return value ? value.slice(0, 180) : null;
}

function absoluteResourceUrls(html: string, baseUrl: string): string {
  return html.replace(/\b(src|href|action|poster|data-src)\s*=\s*(["'])([\s\S]*?)\2/gi, (match, attribute, quote, value) => {
    const rawValue = String(value).trim();
    if (!rawValue || /^(?:#|data:|mailto:|tel:|javascript:|https?:\/\/)/i.test(rawValue)) return match;
    try {
      return `${attribute}=${quote}${new URL(rawValue, baseUrl).href}${quote}`;
    } catch {
      return match;
    }
  });
}

function preserveInlineHeadStyles(html: string): string {
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i)?.[1] ?? "";
  const styles = [...head.matchAll(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi)].map(match => match[0]);
  return styles.length > 0 ? `${styles.join("\n")}\n${html}` : html;
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<string> {
  const contentLength = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new ShopifyPageImportError("The Shopify page is larger than the 5 MB import limit.", 413);
  }

  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new ShopifyPageImportError("The Shopify page is larger than the 5 MB import limit.", 413);
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      totalBytes += next.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new ShopifyPageImportError("The Shopify page is larger than the 5 MB import limit.", 413);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function fetchAndPrepareShopifyPage(rawUrl: string, options: PageImportOptions = {}): Promise<ImportedShopifyPage> {
  const requested = validateShopifyPageUrl(rawUrl, options);
  const fetcher = options.fetcher ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 12_000);

  try {
    const response = await fetcher(requested.href, {
      method: "GET",
      redirect: "follow",
      headers: { Accept: "text/html,application/xhtml+xml" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new ShopifyPageImportError(`Shopify page could not be fetched (HTTP ${response.status}).`, 502);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      throw new ShopifyPageImportError("The selected Shopify URL did not return an HTML page.");
    }

    const finalUrl = response.url || requested.href;
    validateShopifyPageUrl(finalUrl, options);
    const html = await readLimitedBody(response, options.maxBytes ?? DEFAULT_PAGE_IMPORT_MAX_BYTES);
    const importableHtml = preserveInlineHeadStyles(absoluteResourceUrls(html, finalUrl));
    const { normalizedHtml, report } = analyzeHtml(importableHtml);

    return {
      requestedUrl: requested.href,
      finalUrl,
      title: pageTitle(html),
      html,
      normalizedHtml,
      report,
    };
  } catch (error) {
    if (error instanceof ShopifyPageImportError) throw error;
    if ((error as { name?: string })?.name === "AbortError") {
      throw new ShopifyPageImportError("Shopify page import timed out. Try again with the public page URL.", 504);
    }
    throw new ShopifyPageImportError("Shopify page import failed. Confirm the page is public and try again.", 502);
  } finally {
    clearTimeout(timeout);
  }
}
