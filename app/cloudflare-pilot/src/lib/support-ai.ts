import { workerEnvValue } from "./shopify-config.js";
import type { SupportPolicyDecision } from "./support-policy.js";

export interface SupportAiDecision {
  decision: "REPLY" | "WAIT" | "ESCALATE";
  topic: string;
  confidence: number;
  replyText: string;
  reason: string;
  factsUsed: string[];
  unverifiedClaims: string[];
  model: string;
}
const MODEL_LADDER = [
  "z-ai/glm-5.3-flash",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "minimax/minimax-m2.7:free",
  "z-ai/glm-5.2:free",
];

const APPROVED_STORE_FACTS = [
  "Delivery is available throughout Israel and normally takes 5–12 business days.",
  "Shipping is free for orders above ILS 199.",
  "NovaHair currently offers five shades.",
  "The recommended four-bottle offer is ILS 239.",
  "Every order includes a coloring kit valued at ILS 79.",
  "The store offers a 60-day guarantee; any refund, cancellation or shade-change action still requires human review and verified eligibility.",
];

function stripFence(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function extractJson(raw: string): string {
  const clean = stripFence(raw);
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  return start >= 0 && end > start ? clean.slice(start, end + 1) : clean;
}

function redactForModel(value: unknown): unknown {
  const serialized = JSON.stringify(value ?? null)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL_REDACTED]")
    .replace(/(?:\+?972|0)(?:[-\s]?\d){8,9}/g, "[PHONE_REDACTED]")
    .replace(/\b(?:IL|ישראל)?\s*\d{5,}\b/gi, "[REFERENCE_REDACTED]");
  try { return JSON.parse(serialized); }
  catch { return "[UNAVAILABLE]"; }
}

function fallbackDecision(policy: SupportPolicyDecision, reason: string): SupportAiDecision {
  return {
    decision: "ESCALATE",
    topic: policy.topic,
    confidence: 0,
    replyText: "",
    reason,
    factsUsed: [],
    unverifiedClaims: [],
    model: "none",
  };
}

function validDecision(value: any, model: string): SupportAiDecision | null {
  if (!value || !["REPLY", "WAIT", "ESCALATE"].includes(value.decision)) return null;
  if (typeof value.replyText !== "string" || typeof value.reason !== "string" || typeof value.topic !== "string") return null;
  const confidence = Number(value.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  if (!Array.isArray(value.factsUsed) || !Array.isArray(value.unverifiedClaims)) return null;
  const replyText = value.replyText.trim().slice(0, 1600);
  if (value.decision === "REPLY" && !/[\u0590-\u05ff]/.test(replyText)) return null;
  return {
    decision: value.decision,
    topic: value.topic.slice(0, 80),
    confidence,
    replyText,
    reason: value.reason.slice(0, 500),
    factsUsed: value.factsUsed.map(String).slice(0, 12),
    unverifiedClaims: value.unverifiedClaims.map(String).slice(0, 12),
    model,
  };
}

export async function generateSupportDecision(input: {
  subject: string;
  threadText: string;
  ownerExamples: Array<{ customerMessage: string; ownerReply: string }>;
  orderContext: unknown;
  policy: SupportPolicyDecision;
  audienceType: string;
}): Promise<SupportAiDecision> {
  const apiKey = workerEnvValue("OPENROUTER_API_KEY");
  if (!apiKey) return fallbackDecision(input.policy, "OpenRouter is not configured; human review is required.");
  const pinned = workerEnvValue("SUPPORT_OPENROUTER_MODEL") || workerEnvValue("OPENROUTER_MODEL");
  const ladder = pinned ? [pinned] : MODEL_LADDER;
  const deadline = Date.now() + 18_000;

  for (const model of ladder) {
    const remaining = deadline - Date.now();
    if (remaining < 500) break;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(8_000, remaining));
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": workerEnvValue("APP_URL") || "https://tigerbrandsglobal.com",
          "X-Title": "Tiger Brands AI Support",
        },
        body: JSON.stringify({
          model,
          max_tokens: 900,
          temperature: 0.25,
          reasoning: { effort: "low" },
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: [
                "You are the email support assistant for Tiger Brands Global, serving Israeli customers.",
                "Return JSON only with: decision, topic, confidence, replyText, reason, factsUsed, unverifiedClaims.",
                "Write replyText in warm, natural, concise Israeli Hebrew and address the customer in feminine form when the wording allows it.",
                "Lead with the direct answer, then one calming next step. Sound like a responsible retailer, never like a robot or aggressive salesperson.",
                "Never invent order status, tracking movement, delivery date, refund, cancellation, policy, product result or medical claim.",
                "Only use approvedStoreFacts and verifiedOrderContext as factual sources. Owner examples are voice examples only.",
                "If the request concerns chargeback, legal action, safety/medical issues, fraud, refund, cancellation, address change, identity uncertainty or conflicting facts: decision must be ESCALATE and replyText must be empty.",
                "For a general pre-sale delivery or shipping question, a verified order is not required; answer only from approved store facts.",
                "For a personal order/tracking question, verified order context is required. Otherwise escalate.",
                "Do not mention AI, internal policy, confidence, risk labels or missing tools to the customer.",
                "Do not include an email address, phone number, full address or internal order identifier in replyText.",
              ].join("\n"),
            },
            {
              role: "user",
              content: JSON.stringify({
                audienceType: input.audienceType,
                subject: redactForModel(input.subject),
                conversation: redactForModel(input.threadText),
                deterministicPolicy: input.policy,
                approvedStoreFacts: APPROVED_STORE_FACTS,
                verifiedOrderContext: redactForModel(input.orderContext),
                ownerVoiceExamples: redactForModel(input.ownerExamples.slice(0, 8)),
              }),
            },
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) continue;
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string | null } }> };
      const raw = payload.choices?.[0]?.message?.content || "";
      const parsed = validDecision(JSON.parse(extractJson(raw)), model);
      if (!parsed) continue;
      if (input.policy.mustEscalate) return { ...parsed, decision: "ESCALATE", replyText: "", confidence: Math.min(parsed.confidence, 0.7) };
      return parsed;
    } catch {
      // A failed or malformed rung is never surfaced to the customer; try the next vetted rung.
    } finally {
      clearTimeout(timer);
    }
  }
  return fallbackDecision(input.policy, "All configured OpenRouter support models failed their response gate.");
}
