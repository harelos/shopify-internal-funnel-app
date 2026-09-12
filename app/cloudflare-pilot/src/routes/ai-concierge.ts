/**
 * NovaHair AI concierge - server routes.
 *
 * Mounted in server.ts:
 *   app.use("/apps/funnels/api", requireShopifySession, aiConciergeStorefront); // POST /ai-chat
 *   app.use("/api", <session>, aiConciergeAdmin);                               // GET  /ai-steps
 *
 * Two routers on purpose. /ai-chat is storefront (proxy-signed) and must be
 * reachable by shoppers. /ai-steps returns shopper free text and must NEVER be
 * exposed on the storefront proxy path, only behind the admin session.
 *
 * The OpenRouter key stays server-side and never reaches the browser.
 */
import { Router, type Request } from "express";
import { approvedFactAnswer } from "../lib/ai-approved-facts.js";
import prisma from "../lib/db.js";
import { getShopifyConfig, workerEnvValue } from "../lib/shopify-config.js";
import { parsePayload } from "../lib/popup-analytics.js";
import {
  DEFAULT_POPUP_TRIGGER_CONTROL,
  validatePopupTriggerControl,
} from "../lib/popup-trigger-config.js";
import {
  loadPopupTriggerControl,
  savePopupTriggerControl,
} from "../lib/popup-trigger-config-store.js";
import {
  parseShadeVisionResult,
  reconcileShadeVision,
  validateShadeImageDataUrl,
} from "../lib/shade-vision.js";

const storefront = Router();
const admin = Router();

type ConciergeObservationOutcome = "success" | "fallback" | "failure";

const LOCAL_SHOP_DOMAIN = "local-dev.myshopify.com";

function configuredShopDomain(): string {
  return getShopifyConfig().shopDomain || LOCAL_SHOP_DOMAIN;
}

function isExplicitQaConversation(conversationId: string): boolean {
  return /^(?:qa|test)[_-]/i.test(conversationId);
}

async function resolveShopIdForConcierge(): Promise<string | null> {
  try {
    const byDomain = await prisma.shop.findUnique({ where: { domain: configuredShopDomain() } });
    if (byDomain) return byDomain.id;
    const fallback = await prisma.shop.findFirst();
    return fallback?.id ?? null;
  } catch {
    return null;
  }
}

async function recordConciergeObservation(input: {
  conversationId: string;
  customerQuestion: string;
  aiReply: string;
  selectedModel: string;
  latencyMs: number;
  outcome: ConciergeObservationOutcome;
  nextScreen: string;
  sessionId?: string;
  stepId?: string;
}) {
  const shopId = await resolveShopIdForConcierge();
  if (!shopId) return;

  try {
    await prisma.conciergeReplyObservation.create({
      data: {
        shopId,
        conversationId: input.conversationId || "anon",
        sessionId: input.sessionId || null,
        stepId: input.stepId || null,
        customerQuestion: input.customerQuestion,
        aiReply: input.aiReply,
        selectedModel: input.selectedModel,
        latencyMs: Math.max(0, input.latencyMs),
        outcome: input.outcome,
        nextScreen: input.nextScreen || "",
        isTest: isExplicitQaConversation(input.conversationId),
      },
    });
  } catch (error) {
    console.warn("[ai-concierge] failed to persist observation", (error as Error).message);
  }
}

/* Node ids the model is allowed to route to. Anything else is ignored, so a
 * hallucinated step can never break the flow. */
const ALLOWED_NEXT = new Set([
  "root_choice", "shade_open", "shade_photo", "shade_manual", "shade_narrow",
  "shade_result", "price_open", "price_compare", "price_bundle",
  "proof_roots", "proof_how", "offer", "capture", "graceful",
  // Live testing showed the model correctly saying "I don't know, ask support"
  // but then routing to `capture`, because it had no support step to pick.
  "escalate", "refuse_medical",
]);

const SYSTEM_PROMPT = `את היועצת של NovaHair, מותג צבע שורשים לבית בישראל.
את מדברת עברית ישראלית טבעית, בגוף שני נקבה, ישיר וקצר.

חוקים:
- שתי שורות לכל היותר בכל תשובה.
- אסור להמציא מחירים, אחוזים, מחקרים, המלצות לקוחות או תוצאות.
- אסור להבטיח כיסוי מושלם או תוצאה זהה למספרה.
- שמפו הצבע מיועד לצביעת שורשים בבית, בין הצבע המלא לתור הבא.
- חמישה גוונים: שחור טבעי, חום כהה, חום בהיר, סגול חציל, אדום יין.

עובדות מאושרות. מותר לצטט רק את אלה, ואסור להוסיף עליהן:
- מארז 2 בקבוקים 189 שקל. מארז 4 בקבוקים 239 שקל במקום 758 שקל, חיסכון של 519 שקל, כ-68 אחוז, וזה המומלץ. מארז 6 בקבוקים 319 שקל.
- בקבוק אחד מספיק לעד 30 שימושים לחידוש שורשים.
- ערכת צביעה מלאה בשווי 79 שקל מגיעה במתנה בכל הזמנה.
- משלוח לכל נקודה בארץ תוך 5 עד 12 ימי עסקים. המשלוח חינם מעל 199 שקל.
- 60 יום אחריות מלאה, כולל החלפת גוון או החזר כספי.
- ללא אמוניה, pH 5.5.
- שימוש: לוחצים על המשאבה, מורחים על שיער לח במקלחת, ממתינים 10 עד 15 דקות ושוטפים. בלי ערבוב ובלי מברשות.
- אם היא מתלבטת בין שני גוונים, בוחרים את הבהיר מביניהם.
- אם נשאלת על משהו שלא מופיע כאן, אמרי שאת לא בטוחה והציעי לפנות לשירות הלקוחות. אל תנחשי.
- אם היא שואלת למה נשים עוברות למוצר, עני על השליטה בזמן, חידוש בבית בתוך 10 עד 15 דקות והחיסכון. אל תתני הוראות שימוש במקום תשובה.
- אין מידע מאושר על סניפים, כתובת פיזית או איסוף עצמי. בשאלה כזאת אמרי שאין לך מידע מאושר והפני לשירות הלקוחות. אסור לומר שהמותג אונליין בלבד או שאין סניפים.
- אם היא שואלת משהו רפואי, אמרי שכדאי להתייעץ עם איש מקצוע.
- בלי סימני קריאה מרובים ובלי שפה מכירתית לוחצת.
- בלי אימוג'ים בכלל. אף אחד.
- בלי "אשמח לעזור", "כמובן!", "מעולה!", "אני כאן בשבילך", "שאלה מצוינת".
- בלי לפתוח משפט ב"בהחלט" או "ללא ספק".
- בלי לחזור על מה שהיא אמרה לפני שאת עונה.
- מובילה בשאלה אחת קצרה, לא בהרצאה. שאלה אחת בכל תשובה, לא יותר.
- אם אין לך מה להוסיף, אל תמלאי מילים. עדיף משפט אחד.

החזירי JSON בלבד בפורמט:
{"reply": "<התשובה שלך בעברית>", "next": "<אחד ממזהי השלבים>"}

מזהי שלבים אפשריים: ${Array.from(ALLOWED_NEXT).join(", ")}`;

const EMAIL_BRIDGE_PROMPT = `You are Naama from NovaHair.

The customer just described in Hebrew what is bothering her.

Write exactly ONE short natural Hebrew sentence that shows you understood her specific concern.

Rules:
* Maximum 18 words.
* Sound like a helpful Israeli woman, not a salesperson.
* Do not introduce a new product claim.
* Do not mention a discount.
* Do not invent anything she did not say.
* Do not use generic phrases like “אני מבינה אותך לגמרי”.
* Do not ask a question.
* Do not mention email.
* Return only the sentence.`;

const SHADE_VISION_PROMPT = `Classify only the visible natural hair colour at the scalp and roots.

Return exactly one JSON object:
{"shade":"black|dark_brown|light_brown|eggplant|wine_red|uncertain","confidence":0.0}

Rules:
- Examine the hair touching the scalp first. Ignore skin, eyebrows, clothing, walls and background.
- Ignore shine, sunlight, flash and lighter reflections on the mid-lengths.
- Dark roots must never be called light_brown merely because the lengths have highlights.
- Use eggplant or wine_red only when the hair itself has a clear dyed purple or red cast.
- If roots are hidden, tiny, blurred, heavily filtered or badly lit, return uncertain.
- Do not identify the person or infer age, ethnicity, health or any other personal attribute.`;

/* Several free models wrap the JSON in a markdown fence despite
 * response_format being set. Parsing without stripping loses every route. */
function stripFence(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

/* Models often answer in prose and THEN emit the JSON object. Pull the first
 * balanced object out wherever it sits rather than failing the whole parse. */
function extractJson(raw: string): string {
  const s = stripFence(raw);
  const start = s.indexOf("{");
  if (start === -1) return s;
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return s;
}

/* Hebrew tokenises expensively, so a reply can be cut off mid-string and the
 * JSON never closes. Pull the reply text out rather than show a broken fragment. */
function salvageReply(raw: string): string {
  const m = stripFence(raw).match(/"reply"\s*:\s*"([^"]*)/);
  return m ? m[1] : "";
}

/* Model ladder, ordered by benchmark (harness/bench_models.py, 2026-09-02).
 * Free models are individually unreliable, so we fall through rather than pick.
 * Set OPENROUTER_MODEL to pin one and skip the ladder. */
const MODEL_LADDER = [
  // Paid, ~$0.00012/turn. 1.4s average, 4/4 valid. Formerly "Ox Alpha".
  "z-ai/glm-5.3-flash",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "minimax/minimax-m2.7:free",
  "z-ai/glm-5.2:free",
  "google/gemma-4-31b-it:free",
];

const CHAT_DEADLINE_MS = 8_000;
const MODEL_TIMEOUT_MS = 3_500;

const AGENT_GOALS: Record<string, string> = {
  sales: "היא לקוחה חדשה. עזרי לה להחליט בלי לחץ. הציעי קוד רק אם המחיר עוצר אותה והיא עומדת לעזוב.",
  retention: "היא כבר הזמינה בעבר. עזרי לה להזמין שוב או לשנות גוון. אל תציעי קוד להזמנה ראשונה.",
  vip: "היא לקוחה ותיקה. תני עזרה קצרה ואישית. אל תציעי קוד להזמנה ראשונה.",
  service: "זו שיחת שירות. אל תמכרי. פתרי לפי העובדות או העבירי לשירות לקוחות.",
};

const PLACEMENT_GOALS: Record<string, string> = {
  exit_sales: "עזרי לה לפתור את ההתלבטות לפני יציאה מעמוד המכירה.",
  persistent_sales: "עני על השאלה ועזרי לה להשלים החלטה בעמוד המכירה.",
  exit_home: "עזרי לה להבין מה מתאים והפני לעמוד הנכון בלי לדחוף למכירה.",
  persistent_home: "עזרי לה להתמצא ולמצוא את העמוד או המוצר המתאים.",
};

const ALLOWED_ANGLES = new Set(["default", "cost", "roots", "shade"]);
const ALLOWED_SHADES = new Set(["black", "dark_brown", "light_brown", "eggplant", "wine_red"]);

function enumValue(value: unknown, allowed: Set<string>, fallback: string): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  return allowed.has(candidate) ? candidate : fallback;
}

function toneInstruction(value: unknown): string {
  const parts = new Set(
    (typeof value === "string" ? value : "")
      .split("/")
      .filter(part => ["terse", "normal", "chatty", "casual", "formal", "neutral", "skep", "urg"].includes(part)),
  );
  const instructions: string[] = [];
  if (parts.has("terse") || parts.has("urg")) instructions.push("עני במשפט אחד קצר.");
  else if (parts.has("chatty")) instructions.push("אפשר שני משפטים קצרים.");
  if (parts.has("casual")) instructions.push("דברי בגובה העיניים בלי מליצות.");
  if (parts.has("formal")) instructions.push("שמרי על טון ענייני.");
  if (parts.has("skep")) instructions.push("פתחי בעובדה שאפשר לאמת ואל תבטיחי תוצאה.");
  return instructions.join(" ");
}

function cleanContextValue(value: unknown, max = 80): string {
  return typeof value === "string"
    ? value.replace(/[\r\n<>]/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, max)
    : "";
}

function proxyClientIp(req: Request): string {
  const forwarded = String(req.get("x-forwarded-for") || "").split(",")[0].trim();
  return forwarded || String(req.get("cf-connecting-ip") || req.ip || "").trim();
}

/* Runtime quality gates. Each exists because a real free model produced it. */
const FOREIGN_SCRIPT = /[　-鿿가-힯؀-ۿ]/;      // CJK, Hangul, Arabic
const MASCULINE_ADDRESS = /(?:^|\s)(אתה|תוכל|בוא)(?:\s|$|[.,?!])/;
const INVENTED_SHADE_CODE = /\b\d\.\d\b|\b\d[BbNn]\b/;   // 4.0, 4N, 2B

function normalizeReply(reply: string): string {
  return reply
    .replace(/\s*—\s*/g, ", ")
    .replace(/\s*–\s*/g, ", ")
    .replace(/\s+-\s+/g, ", ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function replyIsAcceptable(reply: string): string | null {
  if (!reply.trim()) return "empty";
  if (FOREIGN_SCRIPT.test(reply)) return "foreign-script";
  if (MASCULINE_ADDRESS.test(reply)) return "masculine-address";
  if (INVENTED_SHADE_CODE.test(reply)) return "invented-shade-code";
  return null;
}

/* Rate limit. The /ai-chat route is already gated to Shopify-proxy-signed
 * storefront requests, so random internet abuse cannot reach it. This caps a
 * single spammer. It is an in-memory soft limit per Worker isolate; for a hard
 * cross-isolate guarantee, move the counter to D1. Keyed by Cloudflare client
 * IP when present (spoof-resistant) and conversation id otherwise. */
const RL_MAX = 15;
const RL_WINDOW_MS = 60_000;
const rlBuckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  // Opportunistic prune so the map cannot grow without bound.
  if (rlBuckets.size > 5000) {
    for (const [k, v] of rlBuckets) if (v.resetAt <= now) rlBuckets.delete(k);
  }
  const b = rlBuckets.get(key);
  if (!b || b.resetAt <= now) {
    rlBuckets.set(key, { count: 1, resetAt: now + RL_WINDOW_MS });
    return false;
  }
  b.count += 1;
  return b.count > RL_MAX;
}

interface ChatBody {
  conversationId?: string;
  sessionId?: string;
  stepId?: string;
  message?: string;
  agent?: string;
  placement?: string;
  tone?: string;
  mode?: "conversation" | "email_bridge";
  context?: { shade?: string; tags?: string[]; angle?: string };
}

storefront.get("/proxy-health", (_req, res) => {
  return res.json({ ok: true, service: "novahair-ai-concierge" });
});

/* Public, read-only runtime configuration. The route still requires Shopify's
 * signed App Proxy request. On storage failure it fails closed: the storefront
 * receives `enabled: false`, while the sales page itself keeps running. */
storefront.get("/popup-trigger-config", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    const stored = await loadPopupTriggerControl();
    return res.json({ ok: true, schemaVersion: 1, ...stored });
  } catch (error) {
    console.error("[POPUP TRIGGER CONFIG READ FAILED]", error);
    return res.json({
      ok: false,
      schemaVersion: 1,
      config: { ...DEFAULT_POPUP_TRIGGER_CONTROL, enabled: false },
      revision: 0,
      updatedAt: null,
      source: "fail_closed",
    });
  }
});

storefront.post("/ai-chat", async (req, res) => {
  const requestStartedAt = Date.now();
  const body = (req.body ?? {}) as ChatBody;
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 400) : "";
  if (!message) return res.status(400).json({ error: "A message is required." });

  const conversationId = cleanContextValue(body.conversationId, 160) || "anon";
  const sessionId = cleanContextValue(body.sessionId, 160);
  const stepId = cleanContextValue(body.stepId, 160);
  const emailBridge = body.mode === "email_bridge";
  const approvedFact = emailBridge ? null : approvedFactAnswer(message);
  if (approvedFact) {
    await recordConciergeObservation({
      conversationId,
      sessionId,
      stepId,
      customerQuestion: message,
      aiReply: approvedFact.reply,
      selectedModel: "approved-facts-v1",
      latencyMs: Date.now() - requestStartedAt,
      outcome: "fallback",
      nextScreen: approvedFact.next,
    });
    return res.json({ ...approvedFact, model: "approved-facts-v1" });
  }
  const clientIp = proxyClientIp(req);
  if ((clientIp && rateLimited(`ip:${clientIp}`)) || rateLimited(`conversation:${conversationId}`)) {
    await recordConciergeObservation({
      conversationId,
      sessionId,
      stepId,
      customerQuestion: message,
      aiReply: "",
      selectedModel: "rate-limit",
      latencyMs: Date.now() - requestStartedAt,
      outcome: "fallback",
      nextScreen: "rate_limited",
    });
    // Client treats a fallback flag as "use keyword routing", so a rate-limited
    // shopper still gets a working conversation, just without the LLM.
    return res.status(429).json({ error: "Too many requests.", fallback: true });
  }

  const apiKey = workerEnvValue("OPENROUTER_API_KEY");
  if (!apiKey) {
    await recordConciergeObservation({
      conversationId,
      sessionId,
      stepId,
      customerQuestion: message,
      aiReply: "",
      selectedModel: "config-missing",
      latencyMs: Date.now() - requestStartedAt,
      outcome: "fallback",
      nextScreen: "config_error",
    });
    return res.status(503).json({ error: "AI is not configured.", fallback: true });
  }

  const pinned = workerEnvValue("OPENROUTER_MODEL");
  const ladder = pinned ? [pinned] : MODEL_LADDER;
  const ctx = body.context ?? {};
  const agent = enumValue(body.agent, new Set(Object.keys(AGENT_GOALS)), "sales");
  const placement = enumValue(body.placement, new Set(Object.keys(PLACEMENT_GOALS)), "exit_sales");
  const goal = `${PLACEMENT_GOALS[placement]} ${AGENT_GOALS[agent]}`;
  const style = toneInstruction(body.tone);
  const angle = enumValue(ctx.angle, ALLOWED_ANGLES, "default");
  const shade = enumValue(ctx.shade, ALLOWED_SHADES, "");
  const tags = Array.isArray(ctx.tags)
    ? ctx.tags.slice(0, 8).map(tag => cleanContextValue(tag, 40)).filter(Boolean)
    : [];
  const userContext = [
    `זווית הגעה: ${angle}`,
    shade ? `גוון שזוהה: ${shade}` : "",
    tags.length ? `מה כבר בחרה: ${tags.join(", ")}` : "",
  ].filter(Boolean).join("\n");

  const attempted: string[] = [];
  const deadline = Date.now() + CHAT_DEADLINE_MS;
  try {
    for (const model of ladder) {
      const remaining = deadline - Date.now();
      if (remaining <= 250) break;
      attempted.push(model);
      let upstream: Response;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(MODEL_TIMEOUT_MS, remaining));
      try {
        upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": workerEnvValue("APP_URL") || "https://tigerbrandsglobal.com",
            "X-Title": "NovaHair AI Concierge",
          },
          body: JSON.stringify({
            model,
            max_tokens: emailBridge ? 90 : 700,
            reasoning: { effort: "low" },
            temperature: 0.6,
            ...(emailBridge ? {} : { response_format: { type: "json_object" } }),
            messages: [
              {
                role: "system",
                content: (emailBridge ? EMAIL_BRIDGE_PROMPT : SYSTEM_PROMPT)
                  + (goal ? `\n\nמטרת השיחה: ${goal}` : "")
                  + (style ? `\n\nהתאמת סגנון: ${style}` : ""),
              },
              { role: "user", content: `${userContext}\n\nהיא כתבה: ${message}` },
            ],
          }),
          signal: controller.signal,
        });
      } catch {
        continue;   // network/timeout: try the next rung
      } finally {
        clearTimeout(timer);
      }

      if (!upstream.ok) {
        console.warn("[ai-concierge]", model, upstream.status);
        continue;
      }

      let data: {
        choices?: Array<{ message?: { content?: string | null; reasoning?: string | null } }>;
      };
      try {
        data = await upstream.json() as typeof data;
      } catch {
        continue;
      }
      const msg = data.choices?.[0]?.message;
      const raw = (msg?.content || msg?.reasoning || "").trim();
      if (!raw) continue;

      if (emailBridge) {
        const bridge = normalizeReply(stripFence(raw).replace(/^['\"]|['\"]$/g, ""));
        const words = bridge.split(/\s+/).filter(Boolean);
        if (words.length > 18 || /[?？]|מייל|הנחה|אני מבינה אותך לגמרי/.test(bridge)) continue;
        const bridgeProblem = replyIsAcceptable(bridge);
        if (bridgeProblem) continue;
        await recordConciergeObservation({
          conversationId,
          sessionId,
          stepId,
          customerQuestion: message,
          aiReply: bridge,
          selectedModel: model,
          latencyMs: Date.now() - requestStartedAt,
          outcome: "success",
          nextScreen: "",
        });
        return res.json({ reply: bridge, next: "", model });
      }

      let reply = "";
      let next = "";
      try {
        const parsed = JSON.parse(extractJson(raw));
        reply = typeof parsed.reply === "string" ? parsed.reply.slice(0, 400) : "";
        next = typeof parsed.next === "string" ? parsed.next : "";
      } catch {
        reply = (salvageReply(raw) || raw).slice(0, 400);
      }

      reply = normalizeReply(reply);

      const problem = replyIsAcceptable(reply);
      if (problem) {
        console.warn("[ai-concierge] rejected", model, problem, reply.slice(0, 80));
        continue;
      }

      if (!ALLOWED_NEXT.has(next)) next = "";
      await recordConciergeObservation({
        conversationId,
        sessionId,
        stepId,
        customerQuestion: message,
        aiReply: reply,
        selectedModel: model,
        latencyMs: Date.now() - requestStartedAt,
        outcome: "success",
        nextScreen: next || "",
      });
      return res.json({ reply, next, model });
    }

    console.warn("[ai-concierge] whole ladder failed", attempted.join(","));
    await recordConciergeObservation({
      conversationId,
      sessionId,
      stepId,
      customerQuestion: message,
      aiReply: "",
      selectedModel: attempted[attempted.length - 1] || "all-models-failed",
      latencyMs: Date.now() - requestStartedAt,
      outcome: "failure",
      nextScreen: "",
    });
    return res.status(502).json({ error: "All models unavailable.", fallback: true });
  } catch (error) {
    console.warn("[ai-concierge] chat failed", (error as Error).message);
    await recordConciergeObservation({
      conversationId,
      sessionId,
      stepId,
      customerQuestion: message,
      aiReply: "",
      selectedModel: attempted[attempted.length - 1] || "route-error",
      latencyMs: Date.now() - requestStartedAt,
      outcome: "failure",
      nextScreen: "",
    });
    return res.status(502).json({ error: "AI request failed.", fallback: true });
  }
});

storefront.post("/ai-shade", async (req, res) => {
  const image = validateShadeImageDataUrl(req.body?.image);
  if (!image) return res.status(400).json({ error: "A valid compressed hair photo is required." });

  const conversationId = cleanContextValue(req.body?.conversationId, 160) || "anon";
  const clientIp = proxyClientIp(req);
  if ((clientIp && rateLimited(`shade-ip:${clientIp}`)) || rateLimited(`shade:${conversationId}`)) {
    return res.status(429).json({ error: "Too many requests.", fallback: true });
  }

  const apiKey = workerEnvValue("OPENROUTER_API_KEY");
  if (!apiKey) return res.status(503).json({ error: "Vision is not configured.", fallback: true });

  const model = workerEnvValue("OPENROUTER_VISION_MODEL") || "google/gemini-2.5-flash";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": workerEnvValue("APP_URL") || "https://tigerbrandsglobal.com",
        "X-Title": "NovaHair Shade Advisor",
      },
      body: JSON.stringify({
        model,
        max_tokens: 120,
        temperature: 0,
        provider: { zdr: true },
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SHADE_VISION_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: "Choose the closest available NovaHair shade for these roots." },
              { type: "image_url", image_url: { url: image } },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!upstream.ok) {
      console.warn("[ai-shade] upstream", upstream.status);
      return res.status(502).json({ error: "Vision is temporarily unavailable.", fallback: true });
    }
    const data = await upstream.json() as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const parsed = parseShadeVisionResult(data.choices?.[0]?.message?.content || "");
    if (!parsed) return res.status(502).json({ error: "Vision returned an invalid result.", fallback: true });

    const result = reconcileShadeVision(parsed, req.body?.localSuggestion);
    return res.json({ ok: true, ...result, method: "vision_zdr", model });
  } catch (error) {
    console.warn("[ai-shade] failed", (error as Error).message);
    return res.status(502).json({ error: "Vision is temporarily unavailable.", fallback: true });
  } finally {
    clearTimeout(timer);
  }
});

/* ------------------------------------------------------------------ *
 * GET /ai-steps?days=14  (ADMIN ONLY - returns shopper free text)
 *
 * Per-step funnel over the AI conversation. Mounted only behind the admin
 * session, never on the storefront proxy path.
 * ------------------------------------------------------------------ */
admin.get("/ai-steps", async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 14, 1), 90);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const { default: prisma } = await import("../lib/db.js");
  const rows = await prisma.event.findMany({
    where: { name: "popup_ai_step", occurredAt: { gte: since }, isTest: false },
    select: { payload: true, occurredAt: true },
    orderBy: { occurredAt: "asc" },
    take: 20000,
  });

  interface StepAgg {
    stepId: string;
    stepType: string;
    shown: number;
    answered: number;
    exits: number;
    dwellTotal: number;
    choices: Record<string, number>;
    freeTexts: string[];
  }

  const steps = new Map<string, StepAgg>();
  const conversations = new Set<string>();

  for (const row of rows) {
    const p = parsePayload(row.payload) as Record<string, unknown>;
    const stepId = String(p.stepId ?? "unknown");
    const action = String(p.action ?? "");
    if (p.conversationId) conversations.add(String(p.conversationId));

    let agg = steps.get(stepId);
    if (!agg) {
      agg = { stepId, stepType: String(p.stepType ?? ""), shown: 0, answered: 0, exits: 0, dwellTotal: 0, choices: {}, freeTexts: [] };
      steps.set(stepId, agg);
    }

    if (action === "shown") agg.shown += 1;
    else if (action === "exit") agg.exits += 1;
    else {
      agg.answered += 1;
      agg.dwellTotal += Number(p.dwellMs ?? 0);
      const label = String(p.choiceLabel || p.choiceId || action);
      agg.choices[label] = (agg.choices[label] ?? 0) + 1;
      if (p.freeText && agg.freeTexts.length < 200) agg.freeTexts.push(String(p.freeText));
    }
  }

  const result = Array.from(steps.values())
    .map(s => ({
      stepId: s.stepId,
      stepType: s.stepType,
      shown: s.shown,
      answered: s.answered,
      exits: s.exits,
      dropOffRate: s.shown > 0 ? Number((((s.shown - s.answered) / s.shown) * 100).toFixed(1)) : 0,
      avgDwellSeconds: s.answered > 0 ? Number((s.dwellTotal / s.answered / 1000).toFixed(1)) : 0,
      choices: Object.entries(s.choices).sort((a, b) => b[1] - a[1]).map(([label, n]) => ({ label, count: n })),
      freeTexts: s.freeTexts,
    }))
    .sort((a, b) => b.shown - a.shown);

  return res.json({ days, conversations: conversations.size, steps: result });
});

admin.get("/ai-models", (_req, res) => {
  const pinned = workerEnvValue("OPENROUTER_MODEL");
  return res.json({
    mode: pinned ? "pinned" : "fallback_ladder",
    pinned: pinned || null,
    models: pinned ? [pinned] : MODEL_LADDER,
    timeoutMs: MODEL_TIMEOUT_MS,
    deadlineMs: CHAT_DEADLINE_MS,
  });
});

// Admin-only: customer questions and AI answers remain inside the internal app.
admin.get("/ai-reply-observations", async (req, res) => {
  const conversationId = cleanContextValue(req.query.conversationId as unknown, 160);
  const outcome = String(req.query.outcome || "").trim();
  const days = Math.min(Math.max(Number(req.query.days) || 14, 1), 90);
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const where: Record<string, unknown> = { createdAt: { gte: since }, isTest: false };
  if (conversationId) where.conversationId = conversationId;
  if (outcome === "success" || outcome === "fallback" || outcome === "failure") where.outcome = outcome;

  const rows = await prisma.conciergeReplyObservation.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      conversationId: true,
      sessionId: true,
      stepId: true,
      customerQuestion: true,
      aiReply: true,
      selectedModel: true,
      latencyMs: true,
      outcome: true,
      nextScreen: true,
      isTest: true,
      createdAt: true,
    },
  });

  const byOutcome: Record<string, number> = rows.reduce((acc, row) => {
    acc[row.outcome] = (acc[row.outcome] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return res.json({
    days,
    filters: { conversationId: conversationId || null, outcome: outcome || null, limit },
    count: rows.length,
    byOutcome,
    rows,
  });
});

admin.get("/popup-trigger-config", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    const stored = await loadPopupTriggerControl();
    return res.json({ ok: true, schemaVersion: 1, ...stored });
  } catch (error) {
    console.error("[POPUP TRIGGER CONFIG ADMIN READ FAILED]", error);
    return res.status(503).json({ error: "Popup trigger configuration is unavailable." });
  }
});

admin.put("/popup-trigger-config", async (req, res) => {
  const candidate = req.body && typeof req.body === "object" && "config" in req.body
    ? (req.body as { config?: unknown }).config
    : req.body;
  const validated = validatePopupTriggerControl(candidate);
  if (!validated.ok) {
    return res.status(400).json({ error: "Invalid popup trigger configuration.", errors: validated.errors });
  }

  try {
    const stored = await savePopupTriggerControl(validated.value);
    return res.json({ ok: true, schemaVersion: 1, ...stored });
  } catch (error) {
    console.error("[POPUP TRIGGER CONFIG SAVE FAILED]", error);
    return res.status(503).json({ error: "Popup trigger configuration could not be saved." });
  }
});

/* ------------------------------------------------------------------ *
 * GET /ai-conversations?days=7&limit=50   (ADMIN ONLY)
 *   List recent conversations, newest first, with a one-line summary each.
 * GET /ai-conversation?id=<conversationId>  (ADMIN ONLY)
 *   Full ordered transcript of one conversation, for inspection or to feed to
 *   an AI for review. Returns shopper free text, so admin-only.
 * ------------------------------------------------------------------ */
async function loadAiRows(days: number) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const { default: prisma } = await import("../lib/db.js");
  return prisma.event.findMany({
    where: { name: "popup_ai_step", occurredAt: { gte: since }, isTest: false },
    select: { payload: true, occurredAt: true },
    orderBy: { occurredAt: "asc" },
    take: 40000,
  });
}

admin.get("/ai-conversations", async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
  const rows = await loadAiRows(days);

  interface Convo {
    id: string; agent: string; steps: number; lastStep: string;
    capturedLead: boolean; couponShown: boolean; startedAt: string; lastAt: string;
  }
  const map = new Map<string, Convo>();
  for (const row of rows) {
    const p = parsePayload(row.payload) as Record<string, unknown>;
    const id = String(p.conversationId ?? "");
    if (!id) continue;
    const at = row.occurredAt.toISOString();
    let c = map.get(id);
    if (!c) {
      c = { id, agent: String(p.agent ?? "sales"), steps: 0, lastStep: "",
            capturedLead: false, couponShown: false, startedAt: at, lastAt: at };
      map.set(id, c);
    }
    c.steps += 1;
    c.lastStep = String(p.stepId ?? c.lastStep);
    c.lastAt = at;
    if (p.stepId === "capture" || p.stepId === "capture_coupon") c.capturedLead = c.capturedLead || p.action === "submit";
    if (p.stepId === "coupon_reveal") c.couponShown = true;
  }
  const list = Array.from(map.values())
    .sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1))
    .slice(0, limit);
  return res.json({ days, count: list.length, conversations: list });
});

admin.get("/ai-conversation", async (req, res) => {
  const id = String(req.query.id ?? "");
  if (!id) return res.status(400).json({ error: "id is required" });
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 90);
  const rows = await loadAiRows(days);

  const turns = rows
    .map(row => parsePayload(row.payload) as Record<string, unknown>)
    .filter(p => String(p.conversationId ?? "") === id)
    .map(p => ({
      stepId: p.stepId, stepType: p.stepType, action: p.action,
      choiceLabel: p.choiceLabel || p.choiceId || "", freeText: p.freeText || "",
      dwellMs: p.dwellMs ?? 0, tone: p.tone || "", agent: p.agent || "",
    }));
  if (!turns.length) return res.status(404).json({ error: "conversation not found" });
  return res.json({ id, turns });
});

export const aiConciergeStorefront = storefront;
export const aiConciergeAdmin = admin;
