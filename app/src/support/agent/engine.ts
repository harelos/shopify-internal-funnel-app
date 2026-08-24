import { deterministicDraft } from "./draft-generator.js";
import { decideSupportPolicy } from "./policy-engine.js";
import { detectSupportIntent } from "./skills.js";
import type { SupportAgentInput, SupportAgentResult } from "./contracts.js";

export function runSupportAgentSimulation(input: SupportAgentInput): SupportAgentResult {
  const detected = detectSupportIntent(input.subject, input.message);
  const policy = decideSupportPolicy(detected.intent, input.facts || {});
  const draft = deterministicDraft(detected.intent, input.facts || {}, input.locale || "he");

  const truthSources: SupportAgentResult["truthSources"] = ["RULES"];
  if (input.facts?.order) truthSources.unshift("SHOPIFY");
  if (input.facts?.knowledge) {
    const insertAt = truthSources.includes("SHOPIFY") ? 1 : 0;
    truthSources.splice(insertAt, 0, "KNOWLEDGE");
  }
  if (draft) truthSources.push("MODEL_PROSE");

  return {
    intent: detected.intent,
    confidence: detected.confidence,
    decision: policy.decision,
    risk: policy.risk,
    requiresHuman: policy.requiresHuman,
    missingFacts: policy.missingFacts,
    toolPlan: policy.toolPlan,
    draft,
    truthSources,
    sendAllowed: false,
    shopifyMutationAllowed: false,
  };
}
