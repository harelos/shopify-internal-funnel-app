import { workerEnvValue } from "./shopify-config.js";
import type { SupportPolicyDecision } from "./support-policy.js";
import { deterministicLowRiskDecision, ownerReviewHoldingDraft } from "./support-replies.js";

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
    replyText: ownerReviewHoldingDraft(policy),
    reason,
    factsUsed: [],
    unverifiedClaims: [],
    model: "none",
  };
}

function normalizeReplyText(value: string): string {
  return value
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    // Models occasionally split a Hebrew word at a line break. Repair only
    // letter-to-letter breaks; paragraph breaks and sentence breaks remain.
    .replace(/([\u0590-\u05ff])\n([\u0590-\u05ff])/g, "$1$2")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 1600);
}

function isGenericHoldingReply(value: string): boolean {
  return /קיבלנו את הפנייה|נחזור אלייך לאחר בדיקה|נחזור אליך לאחר בדיקה/i.test(value)
    && value.length < 420;
}

function qualityGate(value: SupportAiDecision, input: { policy: SupportPolicyDecision; orderContext: unknown }): SupportAiDecision | null {
  const replyText = normalizeReplyText(value.replyText);
  if (!replyText) return null;
  if (value.decision === "REPLY" && isGenericHoldingReply(replyText)) return null;
  // A model may not claim to have checked an order, tracking or a refund
  // unless the corresponding verified context was actually supplied.
  const hasOrder = Array.isArray(input.orderContext) && input.orderContext.length > 0;
  if (!hasOrder && /בדקתי את ההזמנה|מספר המעקב|ההזמנה שלך כבר|המשלוח שלך כבר|החזר.*אושר/i.test(replyText)) return null;
  if (/מומחה.*יחזור|נדאג שתצאי מרוצה|נעדכן אותך מיד|עד שהיא תגיע/i.test(replyText)
      && input.policy.topic !== "GENERAL_SHIPPING") return null;
  return { ...value, replyText };
}

function validDecision(value: any, model: string, fallbackTopic: string): SupportAiDecision | null {
  if (!value || !["REPLY", "WAIT", "ESCALATE"].includes(value.decision)) return null;
  if (typeof value.replyText !== "string") return null;
  const confidence = Number(value.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  const replyText = normalizeReplyText(value.replyText);
  if (value.decision === "REPLY" && !/[\u0590-\u05ff]/.test(replyText)) return null;
  return {
    decision: value.decision,
    topic: (typeof value.topic === "string" ? value.topic : fallbackTopic).slice(0, 80),
    confidence,
    replyText,
    reason: (typeof value.reason === "string" ? value.reason : "Model response passed the support reply gate.").slice(0, 500),
    factsUsed: Array.isArray(value.factsUsed) ? value.factsUsed.map(String).slice(0, 12) : [],
    unverifiedClaims: Array.isArray(value.unverifiedClaims) ? value.unverifiedClaims.map(String).slice(0, 12) : [],
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
  approvedStoreFacts: string[];
}): Promise<SupportAiDecision> {
  const deterministic = deterministicLowRiskDecision({ ...input, approvedStoreFacts: input.approvedStoreFacts });
  if (deterministic) return deterministic;
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
          messages: [
            {
              role: "system",
              content: [
                "You are the email support assistant for Tiger Brands Global, serving Israeli customers.",
                "Return JSON only with: decision, topic, confidence, replyText, reason, factsUsed, unverifiedClaims.",
                "Write replyText in warm, natural, concise Israeli Hebrew and address the customer in feminine form when the wording allows it.",
                "Lead with the direct answer to the latest customer message, then one useful next step. Sound like a responsible retailer, never like a robot or aggressive salesperson.",
                "Treat the latest CUSTOMER message as the question to answer. Earlier messages are context only; do not answer an old quoted message or repeat an answer already given by the owner.",
                "Use the owner voice examples as style guidance, not as facts. Keep the natural warmth, short paragraphs and feminine Hebrew seen in those examples.",
                "Do not open with a generic acknowledgement when a direct factual answer is available. Do not say you will check something unless you actually have the required verified context.",
                "Never invent order status, tracking movement, delivery date, refund, cancellation, policy, product result or medical claim.",
                "Only use approvedStoreFacts and verifiedOrderContext as factual sources. Owner examples are voice examples only.",
                "If the request concerns chargeback, legal action, safety/medical issues, fraud, refund, cancellation, address change, identity uncertainty, regulatory approval, ingredients or conflicting facts: decision must be ESCALATE. Provide only a conservative holding draft for owner review; never assert an unverified fact or promise an outcome.",
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
                approvedStoreFacts: input.approvedStoreFacts,
                verifiedOrderContext: redactForModel(input.orderContext),
                ownerVoiceExamples: redactForModel(input.ownerExamples.slice(0, 8)),
              }),
            },
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) continue;
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string | null; reasoning?: string | null } }> };
      const raw = payload.choices?.[0]?.message?.content || payload.choices?.[0]?.message?.reasoning || "";
      const parsed = validDecision(JSON.parse(extractJson(raw)), model, input.policy.topic);
      if (!parsed) continue;
      const gated = qualityGate(parsed, input);
      if (!gated) continue;
      const reviewDraft = gated.replyText || ownerReviewHoldingDraft(input.policy);
      if (input.policy.mustEscalate) return { ...gated, decision: "ESCALATE", replyText: reviewDraft, confidence: Math.min(gated.confidence, 0.7) };
      if (gated.decision === "ESCALATE" && !gated.replyText) return { ...gated, replyText: reviewDraft };
      return gated;
    } catch {
      // A failed or malformed rung is never surfaced to the customer; try the next vetted rung.
    } finally {
      clearTimeout(timer);
    }
  }
  return fallbackDecision(input.policy, "All configured OpenRouter support models failed their response gate.");
}
