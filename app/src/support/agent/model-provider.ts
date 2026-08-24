import { deterministicDraft } from "./draft-generator.js";
import type { SupportAgentFacts, SupportIntent } from "./contracts.js";

export type SupportReplyRequest = {
  intent: SupportIntent;
  locale: string;
  customerMessage: string;
  facts: SupportAgentFacts;
};

export type SupportReply = {
  text: string | null;
  provider: string;
  generated: boolean;
};

export interface SupportModelProvider {
  readonly name: string;
  draftReply(request: SupportReplyRequest): Promise<SupportReply>;
}

/**
 * No API key is required for this provider. It is deliberately constrained to
 * deterministic templates that only reference explicit facts supplied by the
 * orchestration layer. It lets staging exercise the full decision pipeline
 * before any external LLM is connected.
 */
export class DeterministicSupportProvider implements SupportModelProvider {
  readonly name = "DETERMINISTIC_SAFE_FALLBACK";

  async draftReply(request: SupportReplyRequest): Promise<SupportReply> {
    return {
      text: deterministicDraft(request.intent, request.facts, request.locale),
      provider: this.name,
      generated: false,
    };
  }
}

/**
 * Future adapters should implement this interface instead of being called
 * directly from routes. This keeps OpenAI/Gemini/other providers replaceable,
 * allows offline replay tests, and ensures policy/tool authorization happens
 * before model prose is generated.
 */
