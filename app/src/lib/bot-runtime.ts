import { buildBotDecisionPlan } from "./bot-orchestrator.js";
import type { BotConfigurationDraft } from "./bot-config-contract.js";
import { callBotProvider, type BotChatTurn, type BotProviderResult } from "./bot-provider.js";
import { buildBotSystemPrompt, type BotPageContext } from "./bot-prompt.js";
import { enforceBotOutputPolicy } from "./bot-output-policy.js";
import { assertConversationProviderBudget, checkAndRecordMessageRate } from "./bot-guardrails.js";
import { extractExplicitCrmFacts, persistCrmFacts } from "./bot-crm.js";
import { resolveConversationModelAssignment } from "./bot-experiment.js";
import { executeBotTool } from "./bot-tool-executor.js";
import { extractOrderVerification, formatVerifiedTrackingReply, missingOrderVerificationReply } from "./bot-support-runtime.js";
import type { BotVerifiedOrderSummary } from "./bot-shopify-tools.js";
import {
  appendConversationMessage,
  loadConversationMessages,
  pseudonymousVisitorKey,
  recordBotEvent,
  selectKnowledgePacks,
  startConversation,
} from "./bot-runtime-store.js";
import type { BotConversationSignals, LeadCaptureContext, LeadProfileState, PageType } from "./bot-sales-brain.js";

export interface BotRuntimeInput {
  shopDomain: string;
  config: BotConfigurationDraft;
  visitorKey: string;
  conversationId?: string | null;
  message: string;
  pageContext?: BotPageContext;
  profile?: LeadProfileState;
  leadContext?: LeadCaptureContext;
  explicitSignals?: Partial<BotConversationSignals>;
  sessionToken?: string;
}

export interface BotRuntimeToolTrace {
  name: string;
  status: "AWAITING_VERIFICATION" | "SUCCEEDED" | "FAILED" | "UNAVAILABLE";
  errorCode?: string | null;
}

export interface BotRuntimeOutput {
  conversationId: string;
  reply: string;
  route: string;
  routeReason: string;
  salesStage: string | null;
  model: { provider: string; model: string };
  modelAssignmentChanged: boolean;
  latencyMs: number;
  estimatedCostUsd: number | null;
  discount: ReturnType<typeof buildBotDecisionPlan>["discount"];
  nextLeadField: ReturnType<typeof buildBotDecisionPlan>["nextLeadField"];
  allowedTools: readonly string[];
  outputRedacted: boolean;
  crmFactsCaptured: string[];
  toolTrace: BotRuntimeToolTrace[];
}

const HEBREW = {
  order: ["הזמנה", "משלוח", "איפה החבילה", "מעקב", "טרקינג", "לא הגיע", "מתי יגיע"],
  refund: ["החזר", "זיכוי", "לבטל", "ביטול", "תחזירו לי"],
  price: ["יקר", "מחיר", "הנחה", "קופון", "זול", "יקר לי"],
  legal: ["עורך דין", "תביעה", "לתבוע", "משפט", "רשות להגנת הצרכן"],
  chargeback: ["צ'רג'בק", "chargeback", "חברת האשראי", "הכחשת עסקה"],
  product: ["מוצר", "עובד", "מתאים", "איך משתמשים", "כמה זמן", "תוצאה", "גוון", "צבע"],
  exit: ["אחשוב", "אחשוב על זה", "אולי אחר כך", "לא בטוחה", "לא עכשיו"],
};

const PAGE_TYPES = new Set<PageType>(["FUNNEL", "PRODUCT", "CART", "ORDER_TRACKING", "POLICY", "OTHER"]);

function includesAny(text: string, values: string[]): boolean {
  return values.some(value => text.includes(value.toLowerCase()));
}

function normalizedPageType(pageContext: BotPageContext): PageType {
  const raw = String(pageContext.pageType || (pageContext.productId ? "PRODUCT" : "OTHER")).toUpperCase() as PageType;
  return PAGE_TYPES.has(raw) ? raw : "OTHER";
}

export function detectSecuritySignal(message: string): { suspected: boolean; reason?: string } {
  const text = message.toLowerCase();
  const suspicious = [
    "ignore previous instructions",
    "ignore all previous",
    "system prompt",
    "developer message",
    "reveal your prompt",
    "api key",
    "access token",
    "show secrets",
    "internal margin",
    "כל ההוראות הקודמות",
    "תתעלם מההוראות",
    "פרומפט מערכת",
    "מפתח api",
    "טוקן גישה",
    "תראה לי סודות",
  ];
  const found = suspicious.find(item => text.includes(item));
  return found ? { suspected: true, reason: found } : { suspected: false };
}

export function inferConversationSignals(message: string, pageContext: BotPageContext = {}, messageCount = 1): BotConversationSignals {
  const text = message.toLowerCase().trim();
  const security = detectSecuritySignal(text);
  const orderIssue = includesAny(text, HEBREW.order) || /\border\b|\btracking\b|\bdelivery\b/.test(text);
  const refundRequest = includesAny(text, HEBREW.refund) || /\brefund\b|\bcancel\b/.test(text);
  const legalThreat = includesAny(text, HEBREW.legal) || /\blawyer\b|\bsue\b|\blegal action\b/.test(text);
  const chargebackThreat = includesAny(text, HEBREW.chargeback);
  const priceObjection = includesAny(text, HEBREW.price) || /\btoo expensive\b|\bdiscount\b|\bcoupon\b/.test(text);
  const productQuestion = includesAny(text, HEBREW.product) || Boolean(pageContext.productId || pageContext.productTitle) || /\bproduct\b|\bhow does\b|\bdoes it work\b/.test(text);
  const exitOrAbandonmentSignal = includesAny(text, HEBREW.exit) || /\bmaybe later\b|\bnot now\b|\bthink about it\b/.test(text);
  const highIntent = /\bbuy\b|\bcheckout\b|\border now\b|לקנות|להזמין|איפה קונים|איך מזמינים/.test(text);

  return {
    pageType: normalizedPageType(pageContext),
    customerMessages: messageCount,
    productQuestion,
    orderIssue,
    refundRequest,
    chargebackThreat,
    legalThreat,
    promptInjectionSuspected: security.suspected,
    returningCustomer: Boolean(pageContext.returningCustomer),
    vipCustomer: Boolean(pageContext.vipCustomer),
    priceObjection,
    exitOrAbandonmentSignal,
    purchaseIntent: highIntent ? "HIGH" : productQuestion || priceObjection ? "MEDIUM" : "LOW",
    cartValueIls: pageContext.cartValueIls ?? null,
  };
}

function mergeSignals(base: BotConversationSignals, override?: Partial<BotConversationSignals>): BotConversationSignals {
  return { ...base, ...(override || {}), pageType: override?.pageType && PAGE_TYPES.has(override.pageType) ? override.pageType : base.pageType, customerMessages: Number(override?.customerMessages ?? base.customerMessages) };
}

function discountPolicyFromConfig(config: BotConfigurationDraft) {
  return {
    maxDiscountPct: config.offers.maxPct,
    firstDiscountPct: config.offers.firstPct,
    secondDiscountPct: config.offers.secondPct,
    minMessagesBeforeDiscount: config.offers.firstMinMessages,
    minMessagesBeforeSecondDiscount: config.offers.secondMinMessages,
  };
}

function deterministicHandoffReply(route: string): string {
  if (route === "RISK") return "אני מעבירה את זה לבדיקה מסודרת כדי שלא אתן לך תשובה חלקית או לא מדויקת. שמרתי את ההקשר של השיחה לצוות המטפל.";
  return "אני מעבירה את זה לטיפול מתאים כדי שתקבלי תשובה מדויקת. שמרתי את ההקשר של השיחה כדי שלא תצטרכי להתחיל מחדש.";
}

export async function runBotTurn(input: BotRuntimeInput): Promise<BotRuntimeOutput> {
  const message = String(input.message || "").trim();
  if (!message) throw new Error("Message is required.");
  if (message.length > input.config.security.maxUserChars) throw new Error("Message exceeds configured bot input limit.");

  await checkAndRecordMessageRate(input.shopDomain, input.visitorKey, {
    messagesPer5m: input.config.security.messagesPer5m,
    messagesPerHour: input.config.security.messagesPerHour,
  });

  const conversationId = input.conversationId || await startConversation(input.shopDomain, {
    visitorKeyHash: pseudonymousVisitorKey(input.visitorKey),
    pageContext: input.pageContext || {},
  });
  const history = await loadConversationMessages(input.shopDomain, conversationId);
  const userMessageCount = history.filter(item => item.role === "user").length + 1;
  const inferred = inferConversationSignals(message, input.pageContext || {}, userMessageCount);
  const signals = mergeSignals(inferred, input.explicitSignals);
  if (signals.minContributionMarginIls == null && input.config.offers.marginFloorIls != null) {
    signals.minContributionMarginIls = input.config.offers.marginFloorIls;
  }

  const models = input.config.models.map((item, index) => ({
    id: `configured-${index}`,
    provider: item.provider || "custom",
    model: item.model,
    trafficBasisPoints: Math.round(item.trafficPct * 100),
  }));
  const assignment = await resolveConversationModelAssignment(input.shopDomain, conversationId, input.visitorKey, models);
  const plan = buildBotDecisionPlan({
    visitorKey: input.visitorKey,
    signals,
    profile: input.profile || {},
    leadContext: input.leadContext || { customerMessages: userMessageCount },
    models,
    modelVariantOverride: assignment.variant,
    routingPolicy: input.config.routing,
    discountPolicy: discountPolicyFromConfig(input.config),
  });

  const userStored = await appendConversationMessage(input.shopDomain, {
    conversationId,
    role: "user",
    content: message,
    route: plan.route.role,
    provider: plan.modelVariant.provider,
    model: plan.modelVariant.model,
  });
  const crmFacts = extractExplicitCrmFacts(message, conversationId, userStored.id);
  await persistCrmFacts(input.shopDomain, crmFacts);

  const deterministicResult = async (reply: string, eventType: string, toolTrace: BotRuntimeToolTrace[] = []): Promise<BotRuntimeOutput> => {
    await appendConversationMessage(input.shopDomain, {
      conversationId,
      role: "assistant",
      content: reply,
      route: plan.route.role,
      provider: plan.modelVariant.provider,
      model: plan.modelVariant.model,
      latencyMs: 0,
      estimatedCostUsd: 0,
    });
    await recordBotEvent(input.shopDomain, eventType, {
      route: plan.route.role,
      reason: plan.route.reason,
      tools: toolTrace.map(item => ({ name: item.name, status: item.status, errorCode: item.errorCode || null })),
    }, conversationId);
    return {
      conversationId,
      reply,
      route: plan.route.role,
      routeReason: plan.route.reason,
      salesStage: plan.salesStage,
      model: { provider: plan.modelVariant.provider, model: plan.modelVariant.model },
      modelAssignmentChanged: assignment.assignmentChanged,
      latencyMs: 0,
      estimatedCostUsd: 0,
      discount: plan.discount,
      nextLeadField: plan.nextLeadField,
      allowedTools: plan.allowedTools,
      outputRedacted: false,
      crmFactsCaptured: crmFacts.map(fact => fact.type),
      toolTrace,
    };
  };

  if (plan.route.role === "SECURITY") {
    return deterministicResult(
      "אני יכולה לעזור רק בנושאים שקשורים למוצר, להזמנה או לחנות. אם יש לך שאלה כזאת, כתבי לי אותה ואעזור.",
      "bot_security_block",
    );
  }

  if (plan.safeguards.requiresHumanEscalation) {
    return deterministicResult(deterministicHandoffReply(plan.route.role), "bot_human_escalation_required");
  }

  // Order/tracking access is handled deterministically before model prose. The
  // customer must provide an order number plus the email or phone used on the
  // order. Only the server-side Shopify tool can confirm the relationship.
  if (plan.route.role === "SUPPORT" && signals.orderIssue) {
    const verification = extractOrderVerification([
      ...history.filter(item => item.role === "user").map(item => item.content),
      message,
    ]);
    const missingReply = missingOrderVerificationReply(verification);
    if (missingReply) {
      return deterministicResult(missingReply, "bot_order_verification_requested", [
        { name: "tracking.read_scoped", status: "AWAITING_VERIFICATION" },
      ]);
    }

    try {
      const verified = await executeBotTool(
        "tracking.read_scoped",
        { orderName: verification.orderName, email: verification.email, phone: verification.phone },
        {
          role: "SUPPORT",
          conversationId,
          discount: plan.discount,
          sessionToken: input.sessionToken,
        },
      ) as BotVerifiedOrderSummary;
      return deterministicResult(formatVerifiedTrackingReply(verified), "bot_verified_tracking_read", [
        { name: "tracking.read_scoped", status: "SUCCEEDED" },
      ]);
    } catch (error: any) {
      const rawMessage = String(error?.message || "");
      const verificationFailure = /order not found|verification failed|valid order number|required before order access/i.test(rawMessage);
      const unavailable = /live shopify connection is disabled|access token|required for token exchange|network request failed|shopify admin api/i.test(rawMessage);
      const trace: BotRuntimeToolTrace = {
        name: "tracking.read_scoped",
        status: unavailable ? "UNAVAILABLE" : "FAILED",
        errorCode: unavailable ? "AUTHORITATIVE_SOURCE_UNAVAILABLE" : "ORDER_VERIFICATION_FAILED",
      };
      if (verificationFailure) {
        return deterministicResult(
          "לא הצלחתי לאמת את ההזמנה עם הפרטים האלה. בדקי שמספר ההזמנה והאימייל או הטלפון הם בדיוק אלה ששימשו בהזמנה, ונסי שוב.",
          "bot_order_verification_failed",
          [trace],
        );
      }
      return deterministicResult(
        "אני לא מצליחה כרגע לבצע אימות מול מערכת ההזמנות, ולכן אני לא רוצה לנחש סטטוס או זמן הגעה. אפשר לנסות שוב מעט מאוחר יותר או להעביר את הבקשה לטיפול אנושי.",
        "bot_order_source_unavailable",
        [trace],
      );
    }
  }

  await assertConversationProviderBudget(input.shopDomain, conversationId);

  const knowledge = await selectKnowledgePacks(input.shopDomain, {
    funnelId: input.pageContext?.funnelId,
    productId: input.pageContext?.productId,
    pageType: normalizedPageType(input.pageContext || {}),
  });

  const system = buildBotSystemPrompt({
    identity: input.config.identity,
    plan,
    pageContext: input.pageContext || {},
    knowledge: knowledge.map(item => ({ key: item.key, title: item.title, scope: item.scope, text: item.text, priority: item.priority })),
    playbookMethods: input.config.playbook.methods,
  });
  const turns: BotChatTurn[] = history.slice(-12).map(item => ({ role: item.role === "assistant" ? "assistant" : "user", content: item.content }));
  turns.push({ role: "user", content: message });

  let providerResult: BotProviderResult;
  try {
    providerResult = await callBotProvider({
      provider: plan.modelVariant.provider,
      model: plan.modelVariant.model,
      system,
      messages: turns,
      maxOutputTokens: 550,
      temperature: 0.45,
    });
  } catch (error: any) {
    await recordBotEvent(input.shopDomain, "bot_error", {
      route: plan.route.role,
      provider: plan.modelVariant.provider,
      model: plan.modelVariant.model,
      code: error?.code || "MODEL_ERROR",
    }, conversationId);
    throw error;
  }

  const safe = enforceBotOutputPolicy(providerResult.text, plan.discount);
  await appendConversationMessage(input.shopDomain, {
    conversationId,
    role: "assistant",
    content: safe.text,
    route: plan.route.role,
    provider: providerResult.provider,
    model: providerResult.model,
    latencyMs: providerResult.latencyMs,
    estimatedCostUsd: providerResult.usage.estimatedCostUsd,
  });
  await recordBotEvent(input.shopDomain, "bot_model_response", {
    route: plan.route.role,
    salesStage: plan.salesStage,
    provider: providerResult.provider,
    model: providerResult.model,
    latencyMs: providerResult.latencyMs,
    estimatedCostUsd: providerResult.usage.estimatedCostUsd,
    inputTokens: providerResult.usage.inputTokens,
    outputTokens: providerResult.usage.outputTokens,
    discountAction: plan.discount.action,
    outputRedacted: safe.redacted,
    blockedUnauthorizedOffer: safe.blockedUnauthorizedOffer,
    blockedCouponClaim: safe.blockedCouponClaim,
    modelAssignmentChanged: assignment.assignmentChanged,
  }, conversationId);

  return {
    conversationId,
    reply: safe.text,
    route: plan.route.role,
    routeReason: plan.route.reason,
    salesStage: plan.salesStage,
    model: { provider: providerResult.provider, model: providerResult.model },
    modelAssignmentChanged: assignment.assignmentChanged,
    latencyMs: providerResult.latencyMs,
    estimatedCostUsd: providerResult.usage.estimatedCostUsd,
    discount: plan.discount,
    nextLeadField: plan.nextLeadField,
    allowedTools: plan.allowedTools,
    outputRedacted: safe.redacted,
    crmFactsCaptured: crmFacts.map(fact => fact.type),
    toolTrace: [],
  };
}
