export const NOVAHAIR_SHADE_KEYS = [
  "black",
  "dark_brown",
  "light_brown",
  "eggplant",
  "wine_red",
] as const;

export type NovaHairShadeKey = typeof NOVAHAIR_SHADE_KEYS[number];
export type ShadeVisionChoice = NovaHairShadeKey | "uncertain";

export interface ShadeVisionResult {
  shade: ShadeVisionChoice;
  confidence: number;
}

const SHADE_SET = new Set<string>(NOVAHAIR_SHADE_KEYS);
const MAX_IMAGE_BYTES = 750_000;
const MIN_IMAGE_BYTES = 512;

function imageSignatureMatches(mime: string, bytes: Buffer): boolean {
  if (mime === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return signature.every((byte, index) => bytes[index] === byte);
  }
  if (mime === "image/webp") {
    return bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  }
  return false;
}

export function validateShadeImageDataUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 1_050_000) return null;
  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) return null;
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length < MIN_IMAGE_BYTES || bytes.length > MAX_IMAGE_BYTES) return null;
  if (!imageSignatureMatches(match[1], bytes)) return null;
  return value;
}

function extractJsonObject(raw: string): string {
  const clean = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  return start >= 0 && end > start ? clean.slice(start, end + 1) : clean;
}

export function parseShadeVisionResult(raw: string): ShadeVisionResult | null {
  try {
    const parsed = JSON.parse(extractJsonObject(raw)) as { shade?: unknown; confidence?: unknown };
    const shade = String(parsed.shade ?? "").trim();
    if (shade !== "uncertain" && !SHADE_SET.has(shade)) return null;
    const confidence = Number(parsed.confidence);
    if (!Number.isFinite(confidence)) return null;
    return {
      shade: shade as ShadeVisionChoice,
      confidence: Math.max(0, Math.min(1, confidence)),
    };
  } catch {
    return null;
  }
}

function validLocalShade(value: unknown): NovaHairShadeKey | null {
  const shade = String(value ?? "").trim();
  return SHADE_SET.has(shade) ? shade as NovaHairShadeKey : null;
}

/* The local pixel matcher is deliberately a guardrail, not another vote of
 * equal quality. Its common failure is lifting dark hair into light brown when
 * the portrait contains highlights. A confident vision result may correct
 * that direction; the opposite disagreement is sent to manual selection. */
export function reconcileShadeVision(
  vision: ShadeVisionResult,
  localSuggestion: unknown,
): ShadeVisionResult {
  if (vision.shade === "uncertain" || vision.confidence < 0.7) {
    return { shade: "uncertain", confidence: vision.confidence };
  }

  const local = validLocalShade(localSuggestion);
  if (!local || local === vision.shade) return vision;

  if (vision.shade === "dark_brown" && (local === "black" || local === "light_brown")) {
    return { shade: "dark_brown", confidence: vision.confidence };
  }
  if (vision.shade === "black" && local === "dark_brown") {
    return { shade: "dark_brown", confidence: vision.confidence };
  }
  if (vision.shade === "black" && local === "light_brown") {
    return { shade: "uncertain", confidence: vision.confidence };
  }
  if (vision.shade === "light_brown" && (local === "black" || local === "dark_brown")) {
    return { shade: "uncertain", confidence: vision.confidence };
  }

  if ((vision.shade === "eggplant" || vision.shade === "wine_red") && vision.confidence >= 0.86) {
    return vision;
  }
  return { shade: "uncertain", confidence: vision.confidence };
}
