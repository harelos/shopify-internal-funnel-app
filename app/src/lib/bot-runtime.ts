import { buildBotDecisionPlan } from "./bot-orchestrator.js";
import type { BotConfigurationDraft } from "./bot-config-contract.js";
import { callBotProvider, type BotChatTurn, type BotProviderResult } from "./bot-provider.js";
import { buildBotSystemPrompt, type BotPageContext } from "./bot-prompt.js";
import { enforceBotOutputPolicy } from "./bot-output-policy.js";
import { assertConversationProviderBudget, checkAndRecordMessageRate } from "./bot-guardrails.js";
import { extractExplicitCrmFacts, persistCrmFacts } from "./bot-crm.js";
import {
  appendConversationMessage,
  loadConversationMessages,
  pseudonymousVisitorKey,
  recordBotEvent,
  selectKnowledgePacks,
  startConversation,
} from "./bot-runtime-store.js";
import type { BotConversationSignals, LeadCaptureContext, LeadProfileState } from "./bot-sales-brain.js";

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
}

export interface BotRuntimeOutput {
  conversationId: string;
  reply: string;
  route: string;
  routeReason: string;
  model: { provider: string; model: string };
  latencyMs: number;
  estimatedCostUsd: number | null;
  discount: ReturnType<typeof buildBotDecisionPlan>["discount"];
  nextLeadField: ReturnType<typeof buildBotDecisionPlan>["nextLeadField"];
  allowedTools: readonly string[];
  outputRedacted: boolean;
  crmFactsCaptured: string[];
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

function includesAny(text: string, values: string[]): boolean {
  return values.some(value => text.includes(value.toLowerCase()));
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
    pageType: String(pageContext.pageType || (pageContext.productId ? "PRODUCT" : "OTHER")).toUpperCase() as BotConversationSignals["pageType"],
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
  return { ...base, ...(override || {}), customerMessages: Number(override?.customerMessages ?? base.customerMessages) };
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
  const plan = buildBotDecisionPlan({
    visitorKey: input.visitorKey,
    signals,
    profile: input.profile || {},
    leadContext: input.leadContext || { customerMessages: userMessageCount },
    models,
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

  if (plan.route.role === "SECURITY") {
    const reply = "אני יכולה לעזור רק בנושאים שקשורים למוצר, להזמנה או לחנות. אם יש לך שאלה כזאת, כתבי לי אותה ואעזור.";
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
    await recordBotEvent(input.shopDomain, "bot_security_block", { route: plan.route.role, reason: plan.route.reason }, conversationId);
    return {
      conversationId,
      reply,
      route: plan.route.role,
      routeReason: plan.route.reason,
      model: { provider: plan.modelVariant.provider, model: plan.modelVariant.model },
      latencyMs: 0,
      estimatedCostUsd: 0,
      discount: plan.discount,
      nextLeadField: plan.nextLeadField,
      allowedTools: plan.allowedTools,
      outputRedacted: false,
      crmFactsCaptured: crmFacts.map(fact => fact.type),
    };
  }

  await assertConversationProviderBudget(input.shopDomain, conversationId);

  const knowledge = await selectKnowledgePacks(input.shopDomain, {
    funnelId: input.pageContext?.funnelId,
    productId: input.pageContext?.productId,
    pageType: input.pageContext?.pageType,
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
    provider: providerResult.provider,
    model: providerResult.model,
    latencyMs: providerResult.latencyMs,
    estimatedCostUsd: providerResult.usage.estimatedCostUsd,
    inputTokens: providerResult.usage.inputTokens,
    outputTokens: providerResult.usage.outputTokens,
    discountAction: plan.discount.action,
    outputRedacted: safe.redacted,
    blockedUnauthorizedOffer: safe.blockedUnauthorizedOffer,
  }, conversationId);

  return {
    conversationId,
    reply: safe.text,
    route: plan.route.role,
    routeReason: plan.route.reason,
    model: { provider: providerResult.provider, model: providerResult.model },
    latencyMs: providerResult.latencyMs,
    estimatedCostUsd: providerResult.usage.estimatedCostUsd,
    discount: plan.discount,
    nextLeadField: plan.nextLeadField,
    allowedTools: plan.allowedTools,
    outputRedacted: safe.redacted,
    crmFactsCaptured: crmFacts.map(fact => fact.type),
  };
}
