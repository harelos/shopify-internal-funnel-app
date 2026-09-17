export const POPUP_TRIGGER_CONFIG_ID = "novahair-sales-staging";

export const POPUP_TRIGGER_IDS = [
  "return_to_top",
  "fast_scroll_up",
  "idle_after_price",
  "desktop_exit",
  "bundle_hesitation",
  "engaged_drift",
] as const;

export type PopupTriggerId = (typeof POPUP_TRIGGER_IDS)[number];

export interface PopupTriggerControl {
  enabled: boolean;
  gates: {
    minEngagedSeconds: number;
    minTimeOnPage: number;
    minScrollDepth: number;
    minEngagementScore: number;
  };
  abandon: {
    fastScrollUp: { minVelocity: number; settleMs: number };
    returnToTop: { deepAt: number; backTo: number };
    idle: { idleSeconds: number };
    idleAfterPrice: { idleSeconds: number };
  };
  frequency: {
    maxImpressionsPerSession: number;
    maxImpressionsPerVisitor: number;
    dismissCooldownDays: number;
  };
  measurement: {
    signalTracking: boolean;
    experimentId: string;
    holdoutPercent: number;
  };
  triggers: Record<PopupTriggerId, {
    enabled: boolean;
    minAbandonScore: number;
    minEngagementScore?: number;
  }>;
}

export const DEFAULT_POPUP_TRIGGER_CONTROL: PopupTriggerControl = {
  enabled: true,
  gates: {
    minEngagedSeconds: 30,
    minTimeOnPage: 20,
    minScrollDepth: 0.35,
    minEngagementScore: 3,
  },
  abandon: {
    fastScrollUp: { minVelocity: 900, settleMs: 450 },
    returnToTop: { deepAt: 0.6, backTo: 0.15 },
    idle: { idleSeconds: 20 },
    idleAfterPrice: { idleSeconds: 12 },
  },
  frequency: {
    maxImpressionsPerSession: 1,
    maxImpressionsPerVisitor: 3,
    dismissCooldownDays: 7,
  },
  measurement: {
    signalTracking: true,
    experimentId: "novahair_exit_timing_v1",
    holdoutPercent: 0,
  },
  triggers: {
    return_to_top: { enabled: true, minAbandonScore: 3 },
    fast_scroll_up: { enabled: true, minAbandonScore: 3 },
    idle_after_price: { enabled: true, minAbandonScore: 2 },
    desktop_exit: { enabled: true, minAbandonScore: 4 },
    bundle_hesitation: { enabled: true, minAbandonScore: 2 },
    engaged_drift: { enabled: true, minAbandonScore: 5, minEngagementScore: 6 },
  },
};

export type PopupTriggerValidation =
  | { ok: true; value: PopupTriggerControl }
  | { ok: false; errors: string[] };

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function at(root: unknown, path: string[]): unknown {
  return path.reduce<unknown>((value, key) => record(value)[key], root);
}

function booleanAt(root: unknown, path: string[], errors: string[]): boolean {
  const value = at(root, path);
  if (typeof value !== "boolean") {
    errors.push(`${path.join(".")} must be a boolean`);
    return false;
  }
  return value;
}

function numberAt(
  root: unknown,
  path: string[],
  min: number,
  max: number,
  errors: string[],
  integer = false,
): number {
  const value = at(root, path);
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    errors.push(`${path.join(".")} must be ${integer ? "an integer" : "a number"} between ${min} and ${max}`);
    return min;
  }
  return value;
}

function optionalBooleanAt(root: unknown, path: string[], fallback: boolean, errors: string[]): boolean {
  return at(root, path) === undefined ? fallback : booleanAt(root, path, errors);
}

function optionalNumberAt(
  root: unknown,
  path: string[],
  fallback: number,
  min: number,
  max: number,
  errors: string[],
  integer = false,
): number {
  return at(root, path) === undefined ? fallback : numberAt(root, path, min, max, errors, integer);
}

function optionalIdentifierAt(root: unknown, path: string[], fallback: string, errors: string[]): string {
  const value = at(root, path);
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^[a-z0-9_-]{3,80}$/i.test(value)) {
    errors.push(`${path.join(".")} must be a 3-80 character identifier`);
    return fallback;
  }
  return value;
}

export function validatePopupTriggerControl(input: unknown): PopupTriggerValidation {
  const errors: string[] = [];
  const triggers = {} as PopupTriggerControl["triggers"];

  for (const id of POPUP_TRIGGER_IDS) {
    const path = ["triggers", id];
    triggers[id] = {
      enabled: booleanAt(input, [...path, "enabled"], errors),
      minAbandonScore: numberAt(input, [...path, "minAbandonScore"], 0, 50, errors, true),
      ...(id === "engaged_drift"
        ? { minEngagementScore: numberAt(input, [...path, "minEngagementScore"], 0, 50, errors, true) }
        : {}),
    };
  }

  const value: PopupTriggerControl = {
    enabled: booleanAt(input, ["enabled"], errors),
    gates: {
      minEngagedSeconds: numberAt(input, ["gates", "minEngagedSeconds"], 0, 600, errors),
      minTimeOnPage: numberAt(input, ["gates", "minTimeOnPage"], 0, 600, errors),
      minScrollDepth: numberAt(input, ["gates", "minScrollDepth"], 0, 1, errors),
      minEngagementScore: numberAt(input, ["gates", "minEngagementScore"], 0, 50, errors, true),
    },
    abandon: {
      fastScrollUp: {
        minVelocity: numberAt(input, ["abandon", "fastScrollUp", "minVelocity"], 100, 5000, errors),
        settleMs: numberAt(input, ["abandon", "fastScrollUp", "settleMs"], 0, 5000, errors),
      },
      returnToTop: {
        deepAt: numberAt(input, ["abandon", "returnToTop", "deepAt"], 0, 1, errors),
        backTo: numberAt(input, ["abandon", "returnToTop", "backTo"], 0, 1, errors),
      },
      idle: {
        idleSeconds: numberAt(input, ["abandon", "idle", "idleSeconds"], 0, 600, errors),
      },
      idleAfterPrice: {
        idleSeconds: numberAt(input, ["abandon", "idleAfterPrice", "idleSeconds"], 0, 600, errors),
      },
    },
    frequency: {
      maxImpressionsPerSession: numberAt(input, ["frequency", "maxImpressionsPerSession"], 0, 20, errors, true),
      maxImpressionsPerVisitor: numberAt(input, ["frequency", "maxImpressionsPerVisitor"], 0, 100, errors, true),
      dismissCooldownDays: numberAt(input, ["frequency", "dismissCooldownDays"], 0, 365, errors),
    },
    measurement: {
      signalTracking: optionalBooleanAt(
        input,
        ["measurement", "signalTracking"],
        DEFAULT_POPUP_TRIGGER_CONTROL.measurement.signalTracking,
        errors,
      ),
      experimentId: optionalIdentifierAt(
        input,
        ["measurement", "experimentId"],
        DEFAULT_POPUP_TRIGGER_CONTROL.measurement.experimentId,
        errors,
      ),
      holdoutPercent: optionalNumberAt(
        input,
        ["measurement", "holdoutPercent"],
        DEFAULT_POPUP_TRIGGER_CONTROL.measurement.holdoutPercent,
        0,
        50,
        errors,
        true,
      ),
    },
    triggers,
  };

  if (value.abandon.returnToTop.backTo >= value.abandon.returnToTop.deepAt) {
    errors.push("abandon.returnToTop.backTo must be lower than abandon.returnToTop.deepAt");
  }

  return errors.length ? { ok: false, errors } : { ok: true, value };
}
