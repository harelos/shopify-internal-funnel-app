export type FindingSeverity = "portable" | "mapped" | "review" | "unsupported";

export interface PortabilityFinding {
  severity: FindingSeverity;
  subject: string;
  message: string;
  fallback: string;
}

export interface PortabilityReport {
  findings: PortabilityFinding[];
  scriptsRemoved: number;
  iframesRemoved: number;
  documentTagsExtracted: boolean;
}

const scriptPattern = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;
const iframePattern = /<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi;

function matches(html: string, pattern: RegExp): number {
  return [...html.matchAll(pattern)].length;
}

export function analyzeHtml(rawHtml: string): { normalizedHtml: string; report: PortabilityReport } {
  const findings: PortabilityFinding[] = [];
  const hasDocumentTags = /<!doctype|<html\b|<head\b|<body\b/i.test(rawHtml);
  const scriptCount = matches(rawHtml, /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi);
  const iframeCount = matches(rawHtml, /<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi);

  if (hasDocumentTags) findings.push({ severity: "mapped", subject: "Document structure", message: "Full document tags are extracted from the stored render artifact.", fallback: "Render normalized body inside the approved storefront shell." });
  else findings.push({ severity: "portable", subject: "Fragment markup", message: "Markup can be stored as a scoped funnel fragment.", fallback: "Keep the fragment in the funnel shell." });
  if (scriptCount > 0) findings.push({ severity: "review", subject: `${scriptCount} script tag(s)`, message: "Scripts are blocked from the local admin preview and removed from normalized HTML.", fallback: "Allowlist an approved production integration in a later Shopify surface." });
  if (iframeCount > 0) findings.push({ severity: "review", subject: `${iframeCount} iframe(s)`, message: "Iframes are blocked from preview to prevent unreviewed third-party content.", fallback: "Review and serve an approved embed separately." });
  if (/<form\b/i.test(rawHtml)) findings.push({ severity: "review", subject: "Form markup", message: "Generic form actions are not a Shopify checkout handoff.", fallback: "Map a reviewed CTA to Shopify Cart and native /checkout." });
  if (/\bon\w+\s*=/i.test(rawHtml)) findings.push({ severity: "review", subject: "Inline event handler", message: "Inline browser event handlers are removed from preview.", fallback: "Use reviewed storefront instrumentation later." });
  if (/javascript\s*:/i.test(rawHtml)) findings.push({ severity: "unsupported", subject: "javascript: URL", message: "JavaScript URL values are unsafe in imported page content.", fallback: "Replace with a reviewed CTA destination." });

  let normalizedHtml = rawHtml
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, "")
    .replace(/<\/?html\b[^>]*>/gi, "")
    .replace(/<\/?body\b[^>]*>/gi, "")
    .replace(scriptPattern, "")
    .replace(iframePattern, "")
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src)\s*=\s*("|')\s*javascript:[\s\S]*?\2/gi, " $1=\"#\"")
    .trim();

  if (!normalizedHtml) normalizedHtml = "<main><p>No portable markup remains after validation.</p></main>";
  return { normalizedHtml, report: { findings, scriptsRemoved: scriptCount, iframesRemoved: iframeCount, documentTagsExtracted: hasDocumentTags } };
}

export function renderSandboxDocument(normalizedHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>body{margin:0;padding:24px;font-family:Arial,sans-serif;color:#17231e;background:#fffdf8}*{max-width:100%;box-sizing:border-box}</style></head><body>${normalizedHtml}</body></html>`;
}
