import { fetchAndPrepareShopifyPage, type ImportedShopifyPage, type PageImportOptions } from "./shopify-page-import.js";

export interface DuplicateFunnelStepInput {
  name: string;
  kind: string;
  sourceUrl?: string;
}

export interface NormalizedDuplicateFunnelStep {
  name: string;
  kind: string;
  sourceUrl?: string;
}

export class DuplicateFunnelInputError extends Error {
  readonly status = 400;
}

const supportedKinds = new Set(["ADVERTORIAL", "SALES", "LANDING", "QUIZ", "OFFER", "OTHER", "CHECKOUT"]);

export function normalizeFunnelSlug(value: unknown): string {
  const slug = String(value ?? "").trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new DuplicateFunnelInputError("Slug must contain lowercase letters, numbers, and single hyphens only.");
  }
  return slug;
}

export function normalizeDuplicateSteps(value: unknown): NormalizedDuplicateFunnelStep[] {
  if (!Array.isArray(value) || value.length < 2) {
    throw new DuplicateFunnelInputError("At least a listicle and sales page step are required.");
  }

  const steps = value.map((item, index) => {
    const input = item && typeof item === "object" ? item as Partial<DuplicateFunnelStepInput> : {};
    const name = String(input.name ?? "").trim();
    const kind = String(input.kind ?? "").trim().toUpperCase();
    const sourceUrl = String(input.sourceUrl ?? "").trim();
    if (!name) throw new DuplicateFunnelInputError(`Step ${index + 1} name is required.`);
    if (!supportedKinds.has(kind)) throw new DuplicateFunnelInputError(`Step ${index + 1} has an unsupported type.`);
    if (kind !== "CHECKOUT" && !sourceUrl) throw new DuplicateFunnelInputError(`Step ${index + 1} requires a Shopify page URL.`);
    if (kind === "CHECKOUT" && sourceUrl) throw new DuplicateFunnelInputError("Checkout steps cannot import page HTML.");
    return { name, kind, ...(sourceUrl ? { sourceUrl } : {}) };
  });

  const checkoutIndexes = steps.map((step, index) => step.kind === "CHECKOUT" ? index : -1).filter(index => index >= 0);
  if (checkoutIndexes.length > 1 || (checkoutIndexes.length === 1 && checkoutIndexes[0] !== steps.length - 1)) {
    throw new DuplicateFunnelInputError("Checkout must be the final step and may appear only once.");
  }
  if (checkoutIndexes.length === 0) steps.push({ name: "Checkout", kind: "CHECKOUT" });
  return steps;
}

export async function importDuplicateStepPages(
  steps: NormalizedDuplicateFunnelStep[],
  options: PageImportOptions,
): Promise<Array<{ step: NormalizedDuplicateFunnelStep; imported?: ImportedShopifyPage }>> {
  return Promise.all(steps.map(async step => ({
    step,
    imported: step.sourceUrl ? await fetchAndPrepareShopifyPage(step.sourceUrl, options) : undefined,
  })));
}

function urlForms(value: string): string[] {
  const url = new URL(value);
  const href = url.href;
  const withoutTrailingSlash = href.replace(/\/$/, "");
  return Array.from(new Set([href, withoutTrailingSlash, `${withoutTrailingSlash}/`].filter(Boolean)));
}

export function replaceImportedLink(html: string, sourceUrl: string, targetUrl: string): string {
  return urlForms(sourceUrl).reduce((current, form) => current.split(form).join(targetUrl), html);
}
