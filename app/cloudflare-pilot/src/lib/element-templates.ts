export const GALLERY_TEMPLATE_KEY = "product-gallery-v1";

export const GALLERY_TEMPLATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    preserveExisting: { type: "boolean" },
    initialIndex: { type: "integer", minimum: 0 },
    showThumbnails: { type: "boolean" },
    items: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "src", "alt"],
        properties: {
          id: { type: "string", maxLength: 80 },
          src: { type: "string", maxLength: 2048 },
          alt: { type: "string", maxLength: 240 },
          caption: { type: "string", maxLength: 300 },
        },
      },
    },
  },
} as const;

export interface GalleryItem {
  id: string;
  src: string;
  alt: string;
  caption?: string;
}

export interface GalleryPayload {
  preserveExisting: boolean;
  initialIndex: number;
  showThumbnails: boolean;
  items: GalleryItem[];
}

function text(value: unknown, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

function safeImageSource(value: unknown): string {
  const source = text(value, 2048);
  if (source.startsWith("/")) return source;
  try {
    const url = new URL(source);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function objectPayload(input: unknown): Record<string, unknown> {
  if (typeof input === "string") {
    const parsed = JSON.parse(input) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Payload must be a JSON object.");
    return parsed as Record<string, unknown>;
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Payload must be an object.");
  return input as Record<string, unknown>;
}

export function normalizeGalleryPayload(input: unknown): GalleryPayload {
  const payload = objectPayload(input);
  if (payload.preserveExisting === true) {
    return { preserveExisting: true, initialIndex: 0, showThumbnails: true, items: [] };
  }

  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    throw new Error("Gallery variants must contain at least one image.");
  }
  if (payload.items.length > 20) throw new Error("Gallery variants support at most 20 images.");

  const seen = new Set<string>();
  const items = payload.items.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`Gallery item ${index + 1} is invalid.`);
    const item = raw as Record<string, unknown>;
    const id = text(item.id, 80);
    const src = safeImageSource(item.src);
    const alt = text(item.alt, 240);
    const caption = text(item.caption, 300);
    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error(`Gallery item ${index + 1} needs a stable id using letters, numbers, underscores, or hyphens.`);
    if (seen.has(id)) throw new Error(`Gallery item id "${id}" is duplicated.`);
    if (!src) throw new Error(`Gallery item ${index + 1} needs an HTTPS or store-relative image URL.`);
    if (!alt) throw new Error(`Gallery item ${index + 1} needs alt text.`);
    seen.add(id);
    return { id, src, alt, ...(caption ? { caption } : {}) };
  });

  const requestedIndex = Number(payload.initialIndex ?? 0);
  const initialIndex = Number.isInteger(requestedIndex)
    ? Math.max(0, Math.min(items.length - 1, requestedIndex))
    : 0;

  return {
    preserveExisting: false,
    initialIndex,
    showThumbnails: payload.showThumbnails !== false,
    items,
  };
}

export function normalizeElementPayload(templateType: string, input: unknown): string {
  if (templateType !== "GALLERY") throw new Error(`Unsupported element template type: ${templateType}`);
  return JSON.stringify(normalizeGalleryPayload(input));
}

export function parseStoredPayload(payloadJson: string): GalleryPayload {
  return normalizeGalleryPayload(payloadJson);
}
