/**
 * Puts a picture into Shopify Files (Content → Files) and hands back its CDN
 * url, so the page editor can swap an image without anyone leaving the
 * editor. Three Admin API steps: stagedUploadsCreate reserves a bucket slot,
 * the bytes go to that slot as a multipart POST, fileCreate registers the
 * file; Shopify then processes it, so the last step polls until the image
 * has a url. The Admin token never leaves ShopifyAdminClient.
 *
 * Needs the write_files access scope (read_files to poll).
 */
import { ShopifyAdminClient } from "./shopify-admin.js";

export const IMAGE_CONTENT_TYPES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/webp"]);
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** How long fileCreate's processing is given before the route gives up. */
export const IMAGE_READY_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 1_000;

export interface UploadedImage {
  fileId: string;
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
}

const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export function imageExtension(contentType: string): string {
  return EXTENSIONS[contentType] || "bin";
}

/** A file name Shopify accepts: base name only, ASCII, with the extension the bytes really have. */
export function safeImageFilename(value: unknown, contentType: string): string {
  const extension = imageExtension(contentType);
  const base = String(value ?? "").split(/[\\/]/).pop() || "";
  const stem = base.replace(/\.[a-z0-9]+$/i, "").normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${stem || `image-${Date.now().toString(36)}`}.${extension}`;
}

/** Shopify's own wording is exact but unhelpful in a dialog; the scope problem deserves a plain sentence. */
export function describeUploadError(error: unknown): string {
  const message = String((error as Error)?.message || error);
  if (/access denied|access scope|write_files|read_files|not approved/i.test(message)) {
    return "Shopify refused the upload: the app is missing the write_files access scope (Content → Files). Add write_files and read_files to the app's scopes and reinstall it, then try again.";
  }
  return message.slice(0, 300);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

type StagedTarget = { url: string; resourceUrl: string; parameters: Array<{ name: string; value: string }> };
type MediaImageNode = {
  id: string;
  fileStatus: "UPLOADED" | "PROCESSING" | "READY" | "FAILED";
  alt: string | null;
  image: { url: string; width: number | null; height: number | null } | null;
  fileErrors?: Array<{ code: string; message: string; details?: string | null }>;
};

const MEDIA_IMAGE_FIELDS = `
  id fileStatus alt
  image { url width height }
  fileErrors { code message details }`;

async function stageUpload(client: ShopifyAdminClient, filename: string, contentType: string, byteLength: number): Promise<StagedTarget> {
  const data = await client.adminGraphql<{ stagedUploadsCreate: { stagedTargets: StagedTarget[]; userErrors: Array<{ field?: string[]; message: string }> } }>(`
    mutation EditorStageUpload($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }`, { input: [{ resource: "IMAGE", filename, mimeType: contentType, httpMethod: "POST", fileSize: String(byteLength) }] });
  const result = data.stagedUploadsCreate;
  if (result.userErrors?.length) throw new Error(`Shopify refused the upload slot: ${result.userErrors.map(e => e.message).join("; ")}`);
  const target = result.stagedTargets?.[0];
  if (!target?.url || !target.resourceUrl) throw new Error("Shopify returned no upload slot.");
  return target;
}

async function putBytes(target: StagedTarget, bytes: Uint8Array, filename: string, contentType: string): Promise<void> {
  const form = new FormData();
  for (const { name, value } of target.parameters) form.append(name, value);
  // the storage bucket ignores every field after the file, so it goes last
  form.append("file", new Blob([bytes], { type: contentType }), filename);
  const response = await fetch(target.url, { method: "POST", body: form, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`The upload storage returned HTTP ${response.status}.`);
}

async function registerFile(client: ShopifyAdminClient, target: StagedTarget, filename: string, alt: string): Promise<MediaImageNode> {
  const data = await client.adminGraphql<{ fileCreate: { files: MediaImageNode[]; userErrors: Array<{ field?: string[]; message: string; code?: string }> } }>(`
    mutation EditorRegisterFile($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files { ${MEDIA_IMAGE_FIELDS} }
        userErrors { field message code }
      }
    }`, { files: [{ originalSource: target.resourceUrl, contentType: "IMAGE", filename, alt, duplicateResolutionMode: "APPEND_UUID" }] });
  const result = data.fileCreate;
  if (result.userErrors?.length) throw new Error(`Shopify did not accept the file: ${result.userErrors.map(e => e.message).join("; ")}`);
  const file = result.files?.[0];
  if (!file?.id) throw new Error("Shopify created no file.");
  return file;
}

async function readFile(client: ShopifyAdminClient, id: string): Promise<MediaImageNode | null> {
  const data = await client.adminGraphql<{ node: MediaImageNode | null }>(`
    query EditorFileStatus($id: ID!) { node(id: $id) { ... on MediaImage { ${MEDIA_IMAGE_FIELDS} } } }`, { id });
  return data.node;
}

function finished(file: MediaImageNode): UploadedImage | null {
  if (file.fileStatus === "FAILED") {
    throw new Error(`Shopify could not process the picture: ${file.fileErrors?.map(e => e.message || e.code).join("; ") || "unknown error"}`);
  }
  if (file.fileStatus === "READY" && file.image?.url) {
    return { fileId: file.id, url: file.image.url, alt: file.alt || "", width: file.image.width ?? null, height: file.image.height ?? null };
  }
  return null;
}

/**
 * Stage, upload, register, then wait for Shopify to finish processing.
 * Resolves with the CDN url once the image is READY; rejects when Shopify
 * rejects the file or the wait runs out (the file still exists in Files then).
 */
export async function uploadImageToShopifyFiles(
  input: { bytes: Uint8Array; filename: string; contentType: string; alt?: string },
  client: ShopifyAdminClient = new ShopifyAdminClient(),
  options: { timeoutMs?: number; now?: () => number } = {},
): Promise<UploadedImage> {
  if (!IMAGE_CONTENT_TYPES.has(input.contentType)) throw new Error("Only PNG, JPG and WEBP pictures can be uploaded.");
  if (!input.bytes.length) throw new Error("The picture is empty.");
  if (input.bytes.length > MAX_IMAGE_BYTES) throw new Error(`The picture is ${Math.round(input.bytes.length / 1024 / 1024 * 10) / 10} MB; the limit is 8 MB.`);
  const filename = safeImageFilename(input.filename, input.contentType);
  const alt = String(input.alt ?? "").trim().slice(0, 300);

  const target = await stageUpload(client, filename, input.contentType, input.bytes.length);
  await putBytes(target, input.bytes, filename, input.contentType);
  let file = await registerFile(client, target, filename, alt);

  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeoutMs ?? IMAGE_READY_TIMEOUT_MS);
  for (;;) {
    const done = finished(file);
    if (done) return done;
    if (now() >= deadline) throw new Error(`Shopify is still processing "${filename}". It is in Content → Files; paste its link into the Image URL box in a moment.`);
    await sleep(POLL_INTERVAL_MS);
    file = (await readFile(client, file.id)) ?? file;
  }
}
