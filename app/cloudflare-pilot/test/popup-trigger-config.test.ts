import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_POPUP_TRIGGER_CONTROL,
  POPUP_TRIGGER_IDS,
  validatePopupTriggerControl,
} from "../src/lib/popup-trigger-config.js";

test("accepts the complete production trigger configuration", () => {
  const result = validatePopupTriggerControl(structuredClone(DEFAULT_POPUP_TRIGGER_CONTROL));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.enabled, true);
    assert.deepEqual(Object.keys(result.value.triggers), [...POPUP_TRIGGER_IDS]);
    assert.deepEqual(result.value.measurement, {
      signalTracking: true,
      experimentId: "novahair_exit_timing_v1",
      holdoutPercent: 0,
    });
  }
});

test("adds safe measurement defaults to an older stored configuration", () => {
  const candidate = structuredClone(DEFAULT_POPUP_TRIGGER_CONTROL) as unknown as Record<string, unknown>;
  delete candidate.measurement;

  const result = validatePopupTriggerControl(candidate);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.measurement.holdoutPercent, 0);
});

test("rejects malformed values and unsafe thresholds", () => {
  const candidate = structuredClone(DEFAULT_POPUP_TRIGGER_CONTROL);
  candidate.gates.minScrollDepth = 4;
  candidate.frequency.maxImpressionsPerSession = 1.5;
  candidate.abandon.returnToTop.backTo = candidate.abandon.returnToTop.deepAt;
  candidate.measurement.holdoutPercent = 60;

  const result = validatePopupTriggerControl(candidate);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some(error => error.includes("minScrollDepth")));
    assert.ok(result.errors.some(error => error.includes("maxImpressionsPerSession")));
    assert.ok(result.errors.some(error => error.includes("backTo must be lower")));
    assert.ok(result.errors.some(error => error.includes("holdoutPercent")));
  }
});

test("requires a boolean switch for every known trigger", () => {
  const candidate = structuredClone(DEFAULT_POPUP_TRIGGER_CONTROL) as unknown as Record<string, unknown>;
  const triggers = candidate.triggers as Record<string, Record<string, unknown>>;
  delete triggers.desktop_exit.enabled;

  const result = validatePopupTriggerControl(candidate);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some(error => error.includes("desktop_exit.enabled")));
});
