export type BotChatRole = "system" | "user" | "assistant";

export interface BotChatTurn {
  role: BotChatRole;
  content: string;
}

export interface BotProviderRequest {
  provider: string;
  model: string;
  system: string;
  messages: BotChatTurn[];
  maxOutputTokens?: number;
  temperature?: number;
}

export interface BotProviderUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
}

export interface BotProviderResult {
  text: string;
  provider: string;
  model: string;
  latencyMs: number;
  usage: BotProviderUsage;
  fallbackUsed: false;
}

export class BotProviderError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "BotProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

type Pricing = { inputPerMillion?: number; outputPerMillion?: number };

function safeJsonEnv(name: string): Record<string, Pricing> {
  const raw = process.env[name];
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Record<string, Pricing> : {};
  } catch {
    return {};
  }
}

function estimatedCost(provider: string, model: string, inputTokens: number | null, outputTokens: number | null): number | null {
  if (inputTokens == null || outputTokens == null) return null;
  const pricing = safeJsonEnv("BOT_MODEL_PRICING_JSON");
  const row = pricing[`${provider}:${model}`] || pricing[model];
  if (!row) return null;
  const input = Number(row.inputPerMillion);
  const output = Number(row.outputPerMillion);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  return Number(((inputTokens / 1_000_000) * input + (outputTokens / 1_000_000) * output).toFixed(6));
}

async function sleep(ms: number) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url: string, init: RequestInit, attempts = 2): Promise<any> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
      const body = await response.json().catch(() => ({}));
      if (response.ok) return body;
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === attempts - 1) {
        throw new BotProviderError(
          response.status === 429 ? "RATE_LIMITED" : "PROVIDER_HTTP_ERROR",
          `Model provider returned HTTP ${response.status}.`,
          retryable,
        );
      }
      await sleep(250 + Math.floor(Math.random() * 250));
    } catch (error) {
      lastError = error;
      if (error instanceof BotProviderError && !error.retryable) throw error;
      if (attempt === attempts - 1) break;
      await sleep(250 + Math.floor(Math.random() * 250));
    }
  }
  if (lastError instanceof BotProviderError) throw lastError;
  throw new BotProviderError("PROVIDER_NETWORK_ERROR", "Model provider request failed.", true);
}

function usageResult(provider: string, model: string, inputTokens: unknown, outputTokens: unknown, totalTokens?: unknown): BotProviderUsage {
  const input = Number.isFinite(Number(inputTokens)) ? Number(inputTokens) : null;
  const output = Number.isFinite(Number(outputTokens)) ? Number(outputTokens) : null;
  const total = Number.isFinite(Number(totalTokens)) ? Number(totalTokens) : input != null && output != null ? input + output : null;
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: total,
    estimatedCostUsd: estimatedCost(provider, model, input, output),
  };
}

function extractOpenAiResponseText(payload: any): string {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim();
  for (const item of payload?.output || []) {
    for (const part of item?.content || []) {
      const text = part?.text ?? part?.output_text;
      if (typeof text === "string" && text.trim()) return text.trim();
    }
  }
  return "";
}

async function callOpenAI(req: BotProviderRequest): Promise<BotProviderResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new BotProviderError("PROVIDER_NOT_CONFIGURED", "OpenAI is not configured on the server.");
  const started = Date.now();
  const payload = await fetchJson(`${process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"}/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: req.model,
      instructions: req.system,
      input: req.messages.filter(m => m.role !== "system").map(m => ({ role: m.role, content: m.content })),
      max_output_tokens: req.maxOutputTokens ?? 500,
      temperature: req.temperature ?? 0.5,
    }),
  });
  const text = extractOpenAiResponseText(payload);
  if (!text) throw new BotProviderError("EMPTY_PROVIDER_RESPONSE", "OpenAI returned no assistant text.");
  return {
    text,
    provider: "openai",
    model: req.model,
    latencyMs: Date.now() - started,
    usage: usageResult("openai", req.model, payload?.usage?.input_tokens, payload?.usage?.output_tokens, payload?.usage?.total_tokens),
    fallbackUsed: false,
  };
}

async function callGemini(req: BotProviderRequest): Promise<BotProviderResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new BotProviderError("PROVIDER_NOT_CONFIGURED", "Gemini is not configured on the server.");
  const started = Date.now();
  const base = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";
  const payload = await fetchJson(`${base}/models/${encodeURIComponent(req.model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: req.messages.filter(m => m.role !== "system").map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      generationConfig: {
        maxOutputTokens: req.maxOutputTokens ?? 500,
        temperature: req.temperature ?? 0.5,
      },
    }),
  });
  const text = (payload?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text || "").join("").trim();
  if (!text) throw new BotProviderError("EMPTY_PROVIDER_RESPONSE", "Gemini returned no assistant text.");
  const usage = payload?.usageMetadata || {};
  return {
    text,
    provider: "gemini",
    model: req.model,
    latencyMs: Date.now() - started,
    usage: usageResult("gemini", req.model, usage.promptTokenCount, usage.candidatesTokenCount, usage.totalTokenCount),
    fallbackUsed: false,
  };
}

async function callAnthropic(req: BotProviderRequest): Promise<BotProviderResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new BotProviderError("PROVIDER_NOT_CONFIGURED", "Anthropic is not configured on the server.");
  const started = Date.now();
  const payload = await fetchJson(`${process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": process.env.ANTHROPIC_VERSION || "2023-06-01",
    },
    body: JSON.stringify({
      model: req.model,
      system: req.system,
      messages: req.messages.filter(m => m.role !== "system").map(m => ({ role: m.role, content: m.content })),
      max_tokens: req.maxOutputTokens ?? 500,
      temperature: req.temperature ?? 0.5,
    }),
  });
  const text = (payload?.content || []).map((p: any) => p?.type === "text" ? p.text : "").join("").trim();
  if (!text) throw new BotProviderError("EMPTY_PROVIDER_RESPONSE", "Anthropic returned no assistant text.");
  return {
    text,
    provider: "anthropic",
    model: req.model,
    latencyMs: Date.now() - started,
    usage: usageResult("anthropic", req.model, payload?.usage?.input_tokens, payload?.usage?.output_tokens),
    fallbackUsed: false,
  };
}

async function callXai(req: BotProviderRequest): Promise<BotProviderResult> {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new BotProviderError("PROVIDER_NOT_CONFIGURED", "xAI is not configured on the server.");
  const started = Date.now();
  const payload = await fetchJson(`${process.env.XAI_BASE_URL || "https://api.x.ai/v1"}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: req.model,
      messages: [{ role: "system", content: req.system }, ...req.messages.filter(m => m.role !== "system")],
      max_tokens: req.maxOutputTokens ?? 500,
      temperature: req.temperature ?? 0.5,
    }),
  });
  const text = String(payload?.choices?.[0]?.message?.content || "").trim();
  if (!text) throw new BotProviderError("EMPTY_PROVIDER_RESPONSE", "xAI returned no assistant text.");
  return {
    text,
    provider: "xai",
    model: req.model,
    latencyMs: Date.now() - started,
    usage: usageResult("xai", req.model, payload?.usage?.prompt_tokens, payload?.usage?.completion_tokens, payload?.usage?.total_tokens),
    fallbackUsed: false,
  };
}

function callMock(req: BotProviderRequest): BotProviderResult {
  const last = [...req.messages].reverse().find(message => message.role === "user")?.content || "";
  return {
    text: last ? `בדיקת סימולטור: קיבלתי את ההודעה “${last.slice(0, 90)}”.` : "בדיקת סימולטור מוכנה.",
    provider: "mock",
    model: req.model || "mock-sales",
    latencyMs: 1,
    usage: { inputTokens: null, outputTokens: null, totalTokens: null, estimatedCostUsd: 0 },
    fallbackUsed: false,
  };
}

export function providerStatus() {
  return {
    openai: Boolean(process.env.OPENAI_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    xai: Boolean(process.env.XAI_API_KEY),
    mock: true,
    pricingConfigured: Boolean(process.env.BOT_MODEL_PRICING_JSON),
  };
}

export async function callBotProvider(request: BotProviderRequest): Promise<BotProviderResult> {
  const provider = request.provider.trim().toLowerCase();
  if (provider === "openai") return callOpenAI(request);
  if (provider === "gemini" || provider === "google") return callGemini(request);
  if (provider === "anthropic" || provider === "claude") return callAnthropic(request);
  if (provider === "xai" || provider === "grok") return callXai(request);
  if (provider === "mock") return callMock(request);
  throw new BotProviderError("UNSUPPORTED_PROVIDER", `Unsupported bot provider: ${provider || "empty"}.`);
}
