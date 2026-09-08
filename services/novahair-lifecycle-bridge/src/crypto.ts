const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function base64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return [...digest].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", await importHmacKey(secret), encoder.encode(value)),
  );
  return [...signature].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256Base64(secret: string, value: string): Promise<string> {
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", await importHmacKey(secret), encoder.encode(value)),
  );
  return bytesToBase64(signature);
}

export async function hashEmail(email: string, secret: string): Promise<string> {
  return hmacSha256Hex(secret, email.trim().toLowerCase());
}

export async function hashPayload(payload: unknown): Promise<string> {
  return sha256Hex(stableJson(payload));
}

async function importEncryptionKey(secret: string): Promise<CryptoKey> {
  let raw: Uint8Array;
  try {
    raw = base64ToBytes(secret);
  } catch {
    raw = new Uint8Array();
  }
  if (raw.byteLength !== 32) {
    raw = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(secret)));
  }
  return crypto.subtle.importKey("raw", ownedBuffer(raw), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptSensitive(value: string, secret: string): Promise<string> {
  if (!secret) throw new Error("lifecycle_data_key_missing");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: ownedBuffer(iv) },
      await importEncryptionKey(secret),
      ownedBuffer(encoder.encode(value)),
    ),
  );
  return `v1.${base64Url(iv)}.${base64Url(ciphertext)}`;
}

export async function decryptSensitive(value: string, secret: string): Promise<string> {
  const [version, ivValue, ciphertextValue] = value.split(".");
  if (version !== "v1" || !ivValue || !ciphertextValue) throw new Error("invalid_encrypted_value");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ownedBuffer(base64ToBytes(ivValue)) },
    await importEncryptionKey(secret),
    ownedBuffer(base64ToBytes(ciphertextValue)),
  );
  return decoder.decode(plaintext);
}

export function randomOpaqueToken(bytes = 24): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function constantTimeEqual(left: string, right: string): boolean {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const length = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

export async function verifyShopifyHmac(rawBody: string, supplied: string, secret: string): Promise<boolean> {
  if (!rawBody || !supplied || !secret) return false;
  return constantTimeEqual(await hmacSha256Base64(secret, rawBody), supplied);
}

export async function verifySvixSignature(input: {
  rawBody: string;
  id: string;
  timestamp: string;
  signature: string;
  secret: string;
  now?: number;
  toleranceSeconds?: number;
}): Promise<boolean> {
  const timestampSeconds = Number(input.timestamp);
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000);
  const tolerance = input.toleranceSeconds ?? 300;
  if (!Number.isFinite(timestampSeconds) || Math.abs(nowSeconds - timestampSeconds) > tolerance) return false;
  if (!input.id || !input.signature || !input.secret) return false;

  const secretValue = input.secret.startsWith("whsec_") ? input.secret.slice(6) : input.secret;
  let keyBytes: Uint8Array;
  try {
    keyBytes = base64ToBytes(secretValue);
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    ownedBuffer(keyBytes),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = `${input.id}.${input.timestamp}.${input.rawBody}`;
  const expected = bytesToBase64(
    new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(signed))),
  );
  return input.signature
    .split(" ")
    .map(value => value.split(",", 2))
    .some(([version, signature]) => version === "v1" && Boolean(signature) && constantTimeEqual(signature ?? "", expected));
}
