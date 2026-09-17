import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { DEFAULT_POPUP_TRIGGER_CONTROL } from "../src/lib/popup-trigger-config.js";

const source = readFileSync(
  new URL("../../../popup-engine/assets/novahair-popup-engine.config.js", import.meta.url),
  "utf8",
);

async function runConfig(response: unknown, reject = false) {
  const browserWindow: Record<string, unknown> = {
    Promise,
    setTimeout,
    clearTimeout,
    fetch: reject
      ? () => Promise.reject(new Error("offline"))
      : () => Promise.resolve({ ok: true, json: () => Promise.resolve(response) }),
  };
  vm.runInNewContext(source, { window: browserWindow, isFinite, console });
  await browserWindow.NovaHairPopupConfigReady;
  return browserWindow.NovaHairPopupConfig as typeof DEFAULT_POPUP_TRIGGER_CONTROL & {
    zones?: Record<string, unknown>;
    reporting?: Record<string, unknown>;
  };
}

test("runtime stays disabled when its backend configuration cannot load", async () => {
  const config = await runConfig(null, true);
  assert.equal(config.enabled, false);
});

test("runtime applies backend trigger switches without replacing engine-owned data", async () => {
  const remote = structuredClone(DEFAULT_POPUP_TRIGGER_CONTROL);
  remote.triggers.fast_scroll_up.enabled = false;
  remote.gates.minTimeOnPage = 44;
  remote.measurement.experimentId = "qa_exit_timing";
  remote.measurement.holdoutPercent = 20;
  const config = await runConfig({ config: remote, unsafe: { selectors: ["body"] } });

  assert.equal(config.enabled, true);
  assert.equal(config.gates.minTimeOnPage, 44);
  const trigger = (config as unknown as { triggers: Array<{ id: string; enabled: boolean }> }).triggers
    .find(item => item.id === "fast_scroll_up");
  assert.equal(trigger?.enabled, false);
  assert.equal(config.measurement.experimentId, "qa_exit_timing");
  assert.equal(config.measurement.holdoutPercent, 20);
  assert.ok(config.zones);
  assert.ok(config.reporting);
  assert.equal("unsafe" in config, false);
});
