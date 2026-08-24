import type { SupportAgentFacts, SupportAgentInput, SupportIntent, SupportKnowledgeFacts } from "./contracts.js";
import type { KnowledgeLookupResult, SupportKnowledgePack } from "../knowledge/contracts.js";
import { readProductFacts, readProductUsage, readShadeGuidance, readStorePolicy, type StorePolicyKey } from "../knowledge/store.js";

export type SupportKnowledgeEvidence = {
  key: string;
  found: boolean;
  packId: string;
  packVersion: string;
  source?: string;
  reason?: string;
};

export type SupportContextResolution = {
  facts: SupportAgentFacts;
  evidence: SupportKnowledgeEvidence[];
};

function toEvidence<T>(key: string, result: KnowledgeLookupResult<T>): SupportKnowledgeEvidence {
  if (result.found) {
    return { key, found: true, packId: result.packId, packVersion: result.packVersion, source: result.source };
  }
  return { key, found: false, packId: result.packId, packVersion: result.packVersion, reason: result.reason };
}

function allKnown(pack: SupportKnowledgePack, keys: StorePolicyKey[], rows: SupportKnowledgeEvidence[]): boolean {
  let ok = true;
  for (const key of keys) {
    const result = readStorePolicy(pack, key);
    rows.push(toEvidence(key, result));
    if (!result.found) ok = false;
  }
  return ok;
}

export function resolveKnowledgeContext(pack: SupportKnowledgePack, input: SupportAgentInput, intent: SupportIntent): SupportContextResolution {
  const known: SupportKnowledgeFacts = { ...(input.facts?.knowledge || {}) };
  const rows: SupportKnowledgeEvidence[] = [];

  if (intent === "shipping_policy") {
    known.shippingPolicyKnown = allKnown(pack, [
      "shipping.deliveryWindow",
      "shipping.processingWindow",
      "shipping.freeShippingRule",
      "shipping.regions",
      "shipping.customsAndDuties",
    ], rows);
  }

  if (["return_request", "exchange_request", "refund_request"].includes(intent)) {
    known.returnPolicyKnown = allKnown(pack, [
      "returns.eligibilityWindow",
      "returns.exclusions",
      "returns.returnMethod",
      "returns.refundTiming",
    ], rows);
  }

  const productKey = input.productKey?.trim();
  if (productKey && intent === "product_usage") {
    const result = readProductUsage(pack, productKey);
    rows.push(toEvidence(`product:${productKey}:usage`, result));
    known.productUsageKnown = result.found;
  }
  if (productKey && ["product_question", "product_recommendation"].includes(intent)) {
    const result = readProductFacts(pack, productKey);
    rows.push(toEvidence(`product:${productKey}:facts`, result));
    known.productFactsKnown = result.found;
  }
  if (productKey && intent === "shade_recommendation") {
    const result = readShadeGuidance(pack, productKey);
    rows.push(toEvidence(`product:${productKey}:shade`, result));
    known.shadeGuidanceKnown = result.found;
  }

  return { facts: { ...(input.facts || {}), knowledge: known }, evidence: rows };
}
