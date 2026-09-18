import { env as cloudflareEnv } from "cloudflare:workers";
import type { PageExperimentVariantRow as VariantRow } from "./page-experiment-split.js";

type D1Like = {
  prepare(sql: string): {
    bind(...values: unknown[]): { run(): Promise<unknown>; all(): Promise<{ results?: any[] }>; first(): Promise<any> };
  };
};

export type { PageExperimentVariantRow } from "./page-experiment-split.js";
export {
  EXPERIMENT_KEY_PATTERN,
  VISITOR_COOKIE,
  chooseVariant,
  experimentStatus,
  isValidVisitorKey,
  newVisitorKey,
  normalizeLandingPath,
  normalizeNewExperiment,
  normalizeWeights,
  redirectTarget,
  reuseVisitorKey,
  visitorCookie,
} from "./page-experiment-split.js";

export interface PageExperimentRow {
  id: string;
  shopId: string;
  key: string;
  name: string;
  status: string;
  promotedVariantId: string | null;
}

export function pageExperimentDb(): D1Like | null {
  const envObj = (cloudflareEnv as any) ?? (globalThis as any).__SHOPIFY_WORKER_ENV__;
  return envObj?.DB ?? null;
}

export async function findRunningExperiment(key: string): Promise<{ experiment: PageExperimentRow; variants: VariantRow[] } | null> {
  const db = pageExperimentDb();
  if (!db) return null;
  const experiment = await db
    .prepare(`SELECT "id", "shopId", "key", "name", "status", "promotedVariantId" FROM "PageExperiment" WHERE "key" = ? LIMIT 1`)
    .bind(key)
    .first();
  if (!experiment) return null;
  const variants = await db
    .prepare(`SELECT "id", "key", "label", "landingPath", "weight", "isControl" FROM "PageExperimentVariant" WHERE "experimentId" = ? ORDER BY "isControl" DESC, "key" ASC`)
    .bind(experiment.id)
    .all();
  return { experiment: experiment as PageExperimentRow, variants: (variants.results || []) as VariantRow[] };
}

export async function recordAssignment(input: {
  experimentId: string;
  variantId: string;
  visitorKey: string;
  utm: { source?: string; medium?: string; campaign?: string; content?: string };
  isInternal: boolean;
}): Promise<void> {
  const db = pageExperimentDb();
  if (!db) return;
  await db
    .prepare(`
      INSERT INTO "PageExperimentAssignment"
        ("id", "experimentId", "variantId", "visitorKey", "utmSource", "utmMedium", "utmCampaign", "utmContent", "isInternal")
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT("experimentId", "visitorKey") DO NOTHING
    `)
    .bind(
      `${input.experimentId}:${input.visitorKey}`,
      input.experimentId,
      input.variantId,
      input.visitorKey,
      input.utm.source ?? null,
      input.utm.medium ?? null,
      input.utm.campaign ?? null,
      input.utm.content ?? null,
      input.isInternal ? 1 : 0,
    )
    .run();
}
