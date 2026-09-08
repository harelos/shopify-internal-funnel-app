import { env as cloudflareEnv } from "cloudflare:workers";
import {
  DEFAULT_POPUP_TRIGGER_CONTROL,
  POPUP_TRIGGER_CONFIG_ID,
  type PopupTriggerControl,
  validatePopupTriggerControl,
} from "./popup-trigger-config.js";

type RuntimeEnv = { DB?: D1Database };

export interface StoredPopupTriggerControl {
  config: PopupTriggerControl;
  revision: number;
  updatedAt: string | null;
  source: "database" | "defaults";
}

function database(): D1Database {
  const runtime = (cloudflareEnv as RuntimeEnv | undefined) ?? (globalThis as typeof globalThis & {
    __SHOPIFY_WORKER_ENV__?: RuntimeEnv;
  }).__SHOPIFY_WORKER_ENV__;
  if (!runtime?.DB) throw new Error("Cloudflare D1 binding DB is unavailable.");
  return runtime.DB;
}

interface PopupTriggerRow {
  configJson: string;
  revision: number;
  updatedAt: string;
}

export async function loadPopupTriggerControl(): Promise<StoredPopupTriggerControl> {
  const row = await database()
    .prepare('SELECT "configJson", "revision", "updatedAt" FROM "PopupTriggerConfig" WHERE "id" = ?')
    .bind(POPUP_TRIGGER_CONFIG_ID)
    .first<PopupTriggerRow>();

  if (!row) {
    return { config: DEFAULT_POPUP_TRIGGER_CONTROL, revision: 0, updatedAt: null, source: "defaults" };
  }

  try {
    const parsed = validatePopupTriggerControl(JSON.parse(row.configJson));
    if (!parsed.ok) throw new Error(parsed.errors.join("; "));
    return {
      config: parsed.value,
      revision: Number(row.revision) || 0,
      updatedAt: row.updatedAt || null,
      source: "database",
    };
  } catch (error) {
    console.error("[POPUP TRIGGER CONFIG INVALID]", error);
    return { config: DEFAULT_POPUP_TRIGGER_CONTROL, revision: 0, updatedAt: null, source: "defaults" };
  }
}

export async function savePopupTriggerControl(config: PopupTriggerControl): Promise<StoredPopupTriggerControl> {
  await database().prepare(`
    INSERT INTO "PopupTriggerConfig" ("id", "configJson", "revision", "updatedAt")
    VALUES (?, ?, 1, CURRENT_TIMESTAMP)
    ON CONFLICT("id") DO UPDATE SET
      "configJson" = excluded."configJson",
      "revision" = "PopupTriggerConfig"."revision" + 1,
      "updatedAt" = CURRENT_TIMESTAMP
  `).bind(POPUP_TRIGGER_CONFIG_ID, JSON.stringify(config)).run();

  return loadPopupTriggerControl();
}
