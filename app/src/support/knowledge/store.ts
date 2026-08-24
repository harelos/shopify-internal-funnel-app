import { readFile } from "node:fs/promises";

import type {
  KnowledgeFact,
  KnowledgeLookupResult,
  ProductKnowledge,
  StorePolicyKnowledge,
  SupportKnowledgePack,
} from "./contracts.js";

function unknownFact<T>(source: string): KnowledgeFact<T> {
  return { state: "UNKNOWN", source };
}

export function emptyKnowledgePack(): SupportKnowledgePack {
  const source = "unconfigured:store-knowledge";
  return {
    schemaVersion: 1,
    packId: "unconfigured",
    version: "0.0.0",
    status: "DRAFT",
    effectiveFrom: "1970-01-01T00:00:00.000Z",
    policies: {
      shipping: {
        deliveryWindow: unknownFact(source),
        processingWindow: unknownFact(source),
        freeShippingRule: unknownFact(source),
        regions: unknownFact(source),
        customsAndDuties: unknownFact(source),
      },
      returns: {
        eligibilityWindow: unknownFact(source),
        exclusions: unknownFact(source),
        returnMethod: unknownFact(source),
        refundTiming: unknownFact(source),
      },
      guarantee: unknownFact(source),
      supportContact: unknownFact(source),
    },
    products: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertFact(value: unknown, path: string): void {
  if (!isRecord(value)) throw new Error(`Knowledge pack ${path} must be an object.`);
  if (value.state !== "KNOWN" && value.state !== "UNKNOWN") {
    throw new Error(`Knowledge pack ${path}.state must be KNOWN or UNKNOWN.`);
  }
  if (typeof value.source !== "string" || !value.source.trim()) {
    throw new Error(`Knowledge pack ${path}.source is required.`);
  }
  if (value.state === "KNOWN" && !("value" in value)) {
    throw new Error(`Knowledge pack ${path} is KNOWN but has no value.`);
  }
}

export function validateKnowledgePack(value: unknown): asserts value is SupportKnowledgePack {
  if (!isRecord(value)) throw new Error("Knowledge pack must be an object.");
  if (value.schemaVersion !== 1) throw new Error("Knowledge pack schemaVersion must be 1.");
  if (typeof value.packId !== "string" || !value.packId.trim()) throw new Error("Knowledge pack packId is required.");
  if (typeof value.version !== "string" || !value.version.trim()) throw new Error("Knowledge pack version is required.");
  if (!['DRAFT', 'APPROVED', 'RETIRED'].includes(String(value.status))) throw new Error("Knowledge pack status is invalid.");
  if (typeof value.effectiveFrom !== "string" || Number.isNaN(Date.parse(value.effectiveFrom))) {
    throw new Error("Knowledge pack effectiveFrom must be an ISO date string.");
  }

  if (!isRecord(value.policies)) throw new Error("Knowledge pack policies are required.");
  const policies = value.policies as unknown as StorePolicyKnowledge;
  for (const [key, fact] of Object.entries(policies.shipping || {})) assertFact(fact, `policies.shipping.${key}`);
  for (const [key, fact] of Object.entries(policies.returns || {})) assertFact(fact, `policies.returns.${key}`);
  assertFact(policies.guarantee, "policies.guarantee");
  assertFact(policies.supportContact, "policies.supportContact");

  if (!Array.isArray(value.products)) throw new Error("Knowledge pack products must be an array.");
  for (const [index, raw] of value.products.entries()) {
    if (!isRecord(raw)) throw new Error(`Knowledge pack products[${index}] must be an object.`);
    if (typeof raw.key !== "string" || !raw.key.trim()) throw new Error(`Knowledge pack products[${index}].key is required.`);
    if (typeof raw.title !== "string" || !raw.title.trim()) throw new Error(`Knowledge pack products[${index}].title is required.`);
    if (!Array.isArray(raw.aliases)) throw new Error(`Knowledge pack products[${index}].aliases must be an array.`);
    assertFact(raw.usageInstructions, `products[${index}].usageInstructions`);
    assertFact(raw.productFacts, `products[${index}].productFacts`);
    assertFact(raw.shadeGuidance, `products[${index}].shadeGuidance`);
    assertFact(raw.faq, `products[${index}].faq`);
  }
}

export async function loadKnowledgePack(path?: string): Promise<SupportKnowledgePack> {
  if (!path?.trim()) return emptyKnowledgePack();
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  validateKnowledgePack(raw);
  return raw;
}

function packGate<T>(pack: SupportKnowledgePack): KnowledgeLookupResult<T> | null {
  if (pack.status !== "APPROVED") {
    return { found: false, packId: pack.packId, packVersion: pack.version, reason: "PACK_NOT_APPROVED" };
  }
  return null;
}

function knownFact<T>(pack: SupportKnowledgePack, fact: KnowledgeFact<T>): KnowledgeLookupResult<T> {
  const gate = packGate<T>(pack);
  if (gate) return gate;
  if (fact.state !== "KNOWN" || fact.value === undefined) {
    return { found: false, packId: pack.packId, packVersion: pack.version, reason: "UNKNOWN_FACT" };
  }
  return {
    found: true,
    packId: pack.packId,
    packVersion: pack.version,
    value: fact.value,
    source: fact.source,
    verifiedAt: fact.verifiedAt,
  };
}

export type StorePolicyKey =
  | "shipping.deliveryWindow"
  | "shipping.processingWindow"
  | "shipping.freeShippingRule"
  | "shipping.regions"
  | "shipping.customsAndDuties"
  | "returns.eligibilityWindow"
  | "returns.exclusions"
  | "returns.returnMethod"
  | "returns.refundTiming"
  | "guarantee"
  | "supportContact";

export function readStorePolicy(pack: SupportKnowledgePack, key: StorePolicyKey): KnowledgeLookupResult<unknown> {
  const lookup: Record<StorePolicyKey, KnowledgeFact<unknown>> = {
    "shipping.deliveryWindow": pack.policies.shipping.deliveryWindow,
    "shipping.processingWindow": pack.policies.shipping.processingWindow,
    "shipping.freeShippingRule": pack.policies.shipping.freeShippingRule,
    "shipping.regions": pack.policies.shipping.regions,
    "shipping.customsAndDuties": pack.policies.shipping.customsAndDuties,
    "returns.eligibilityWindow": pack.policies.returns.eligibilityWindow,
    "returns.exclusions": pack.policies.returns.exclusions,
    "returns.returnMethod": pack.policies.returns.returnMethod,
    "returns.refundTiming": pack.policies.returns.refundTiming,
    guarantee: pack.policies.guarantee,
    supportContact: pack.policies.supportContact,
  };
  return knownFact(pack, lookup[key]);
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

export function findProduct(pack: SupportKnowledgePack, query: string): KnowledgeLookupResult<ProductKnowledge> {
  const gate = packGate<ProductKnowledge>(pack);
  if (gate) return gate;
  const target = normalize(query);
  const matches = pack.products.filter((product) => {
    const candidates = [product.key, product.title, ...(product.aliases || [])].map(normalize);
    return candidates.includes(target);
  });
  if (matches.length === 0) return { found: false, packId: pack.packId, packVersion: pack.version, reason: "PRODUCT_NOT_FOUND" };
  if (matches.length > 1) return { found: false, packId: pack.packId, packVersion: pack.version, reason: "AMBIGUOUS_PRODUCT" };
  return {
    found: true,
    packId: pack.packId,
    packVersion: pack.version,
    value: matches[0],
    source: `knowledge-pack:${pack.packId}@${pack.version}`,
  };
}

export function readProductUsage(pack: SupportKnowledgePack, query: string): KnowledgeLookupResult<string[]> {
  const product = findProduct(pack, query);
  if (!product.found) return product;
  return knownFact(pack, product.value.usageInstructions);
}

export function readProductFacts(pack: SupportKnowledgePack, query: string): KnowledgeLookupResult<Record<string, string | number | boolean>> {
  const product = findProduct(pack, query);
  if (!product.found) return product;
  return knownFact(pack, product.value.productFacts);
}

export function readShadeGuidance(pack: SupportKnowledgePack, query: string): KnowledgeLookupResult<string[]> {
  const product = findProduct(pack, query);
  if (!product.found) return product;
  return knownFact(pack, product.value.shadeGuidance);
}
