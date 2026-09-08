import prisma from "../lib/db.js";
import { ShopifyAdminClient } from "../lib/shopify-admin.js";
import { workerEnvValue } from "../lib/shopify-config.js";
import { generateSupportDecision } from "../lib/support-ai.js";
import { evaluateSupportPolicy, mayAutoSend } from "../lib/support-policy.js";
import { triageMailboxMessage, type SupportTriageClass } from "../lib/support-triage.js";

const shopify = new ShopifyAdminClient();

function canonicalEmail(value: string): string {
  return value.trim().toLowerCase();
}

function safeJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function configuredShop() {
  const domain = (workerEnvValue("SHOP_DOMAIN") || "local-dev.myshopify.com").toLowerCase();
  return prisma.shop.upsert({ where: { domain }, update: {}, create: { domain } });
}

function threadKey(input: SupportIngestInput): string {
  if (input.threadKey?.trim()) return input.threadKey.trim().slice(0, 300);
  const rootReference = input.references?.[0] || input.inReplyTo;
  if (rootReference) return rootReference.trim().slice(0, 300);
  const normalizedSubject = input.subject.replace(/^(re|fw|fwd):\s*/gi, "").trim().toLowerCase();
  return `${canonicalEmail(input.customerEmail)}::${normalizedSubject}`.slice(0, 300);
}

export async function appendSupportEvidence(input: {
  conversationId: string;
  kind: string;
  source: string;
  occurredAt: Date;
  payload: unknown;
}) {
  const payloadJson = safeJson(input.payload);
  const previous = await prisma.supportEvidenceEvent.findFirst({
    where: { conversationId: input.conversationId },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    select: { contentHash: true },
  });
  const previousHash = previous?.contentHash || null;
  return prisma.supportEvidenceEvent.create({
    data: {
      conversationId: input.conversationId,
      kind: input.kind,
      source: input.source,
      occurredAt: input.occurredAt,
      payloadJson,
      previousHash,
      contentHash: await sha256(`${previousHash || "GENESIS"}\n${payloadJson}`),
    },
  });
}

export interface SupportIngestInput {
  mailboxAddress: string;
  customerEmail: string;
  customerName?: string | null;
  externalMessageId: string;
  threadKey?: string | null;
  direction: "INBOUND" | "OUTBOUND";
  fromAddress: string;
  toAddresses: string[];
  subject: string;
  textBody: string;
  sentAt: string;
  inReplyTo?: string | null;
  references?: string[];
  attachments?: Array<{ filename?: string | null; contentType?: string | null; size?: number | null; contentHash?: string | null }>;
  source?: string;
  automated?: boolean;
  triageClass?: SupportTriageClass;
  triageScore?: number;
  triageReasons?: string[];
}

export async function ingestSupportMessage(input: SupportIngestInput) {
  const existing = await prisma.supportMessage.findUnique({ where: { externalMessageId: input.externalMessageId } });
  if (existing) return { duplicate: true, conversationId: existing.conversationId, messageId: existing.id };

  const shop = await configuredShop();
  const email = canonicalEmail(input.customerEmail);
  const sentAt = new Date(input.sentAt);
  if (!email.includes("@") || Number.isNaN(sentAt.getTime())) throw new Error("A valid customer email and sentAt timestamp are required.");
  const computedTriage = triageMailboxMessage({
    direction: input.direction,
    fromAddress: input.fromAddress,
    subject: input.subject,
    textBody: input.textBody,
    automated: input.automated,
  });
  const triage = input.triageClass && input.triageClass !== "IGNORE"
    ? {
        classification: input.triageClass,
        confidence: Math.max(0, Math.min(1, Number(input.triageScore ?? computedTriage.confidence))),
        language: computedTriage.language,
        reasons: Array.isArray(input.triageReasons) ? input.triageReasons.slice(0, 12) : computedTriage.reasons,
      }
    : computedTriage;
  if (triage.classification === "IGNORE") {
    return { duplicate: false, ignored: true, triage };
  }
  const policy = evaluateSupportPolicy(`${input.subject}\n${input.textBody}`);
  const mailbox = await prisma.supportMailbox.upsert({
    where: { shopId_address: { shopId: shop.id, address: canonicalEmail(input.mailboxAddress) } },
    update: { connectionStatus: "CONNECTED", lastSyncAt: new Date(), lastError: null },
    create: { shopId: shop.id, address: canonicalEmail(input.mailboxAddress), connectionStatus: "CONNECTED", lastSyncAt: new Date() },
  });
  const customer = await prisma.supportCustomer.upsert({
    where: { shopId_email: { shopId: shop.id, email } },
    update: { displayName: input.customerName?.trim() || undefined, riskLevel: policy.riskLevel, riskReasonsJson: safeJson(policy.flags) },
    create: { shopId: shop.id, email, displayName: input.customerName?.trim() || null, riskLevel: policy.riskLevel, riskReasonsJson: safeJson(policy.flags) },
  });
  const externalThreadKey = threadKey(input);
  const delayMinutes = mailbox.replyDelayMinutes;
  const triageNeedsReview = triage.classification === "REVIEW";
  const audienceType = triage.classification === "SALES_QUESTION" ? "PROSPECT" : "UNVERIFIED_CUSTOMER";
  const conversation = await prisma.supportConversation.upsert({
    where: { shopId_externalThreadKey: { shopId: shop.id, externalThreadKey } },
    update: {
      subject: input.subject || "Customer support",
      status: input.direction === "INBOUND" ? (policy.mustEscalate ? "ESCALATED" : triageNeedsReview ? "NEEDS_TRIAGE" : "OPEN") : "WAITING_CUSTOMER",
      priority: policy.priority,
      topic: policy.topic,
      audienceType,
      triageStatus: triageNeedsReview ? "NEEDS_REVIEW" : "ACCEPTED",
      triageReason: triage.reasons.join(", ") || null,
      language: triage.language,
      riskLevel: policy.riskLevel,
      escalationReason: policy.mustEscalate ? policy.flags.join(", ") : null,
      lastCustomerMessageAt: input.direction === "INBOUND" ? sentAt : undefined,
      lastAgentMessageAt: input.direction === "OUTBOUND" ? sentAt : undefined,
      nextActionAt: input.direction === "INBOUND" && !policy.mustEscalate && !triageNeedsReview ? new Date(sentAt.getTime() + delayMinutes * 60000) : null,
    },
    create: {
      shopId: shop.id,
      mailboxId: mailbox.id,
      customerId: customer.id,
      externalThreadKey,
      subject: input.subject || "Customer support",
      status: input.direction === "INBOUND" ? (policy.mustEscalate ? "ESCALATED" : triageNeedsReview ? "NEEDS_TRIAGE" : "OPEN") : "WAITING_CUSTOMER",
      priority: policy.priority,
      topic: policy.topic,
      audienceType,
      triageStatus: triageNeedsReview ? "NEEDS_REVIEW" : "ACCEPTED",
      triageReason: triage.reasons.join(", ") || null,
      language: triage.language,
      riskLevel: policy.riskLevel,
      escalationReason: policy.mustEscalate ? policy.flags.join(", ") : null,
      lastCustomerMessageAt: input.direction === "INBOUND" ? sentAt : null,
      lastAgentMessageAt: input.direction === "OUTBOUND" ? sentAt : null,
      nextActionAt: input.direction === "INBOUND" && !policy.mustEscalate && !triageNeedsReview ? new Date(sentAt.getTime() + delayMinutes * 60000) : null,
    },
  });
  const message = await prisma.supportMessage.create({
    data: {
      conversationId: conversation.id,
      externalMessageId: input.externalMessageId,
      direction: input.direction,
      fromAddress: canonicalEmail(input.fromAddress),
      toAddressesJson: safeJson(input.toAddresses.map(canonicalEmail)),
      subject: input.subject || "Customer support",
      textBody: input.textBody.trim(),
      sentAt,
      source: input.source || "IMAP",
      deliveryStatus: input.direction === "OUTBOUND" ? "SENT" : "RECEIVED",
      triageClass: triage.classification,
      triageScore: triage.confidence,
      triageReasonsJson: safeJson(triage.reasons),
      inReplyTo: input.inReplyTo || null,
      referencesJson: safeJson(input.references || []),
      attachmentsJson: safeJson(input.attachments || []),
    },
  });
  await appendSupportEvidence({
    conversationId: conversation.id,
    kind: input.direction === "INBOUND" ? "INBOUND_EMAIL" : "OUTBOUND_EMAIL",
    source: input.source || "IMAP",
    occurredAt: sentAt,
    payload: { externalMessageId: input.externalMessageId, subject: input.subject, from: input.fromAddress, to: input.toAddresses, textBody: input.textBody, attachments: input.attachments || [] },
  });

  if (input.direction === "OUTBOUND") {
    const inbound = await prisma.supportMessage.findFirst({
      where: { conversationId: conversation.id, direction: "INBOUND", sentAt: { lte: sentAt } },
      orderBy: { sentAt: "desc" },
    });
    if (inbound) {
      await prisma.supportVoiceExample.upsert({
        where: { shopId_inboundExternalId_outboundExternalId: { shopId: shop.id, inboundExternalId: inbound.externalMessageId, outboundExternalId: input.externalMessageId } },
        update: { ownerReply: input.textBody.trim(), topic: conversation.topic },
        create: { shopId: shop.id, inboundExternalId: inbound.externalMessageId, outboundExternalId: input.externalMessageId, topic: conversation.topic, customerMessage: inbound.textBody, ownerReply: input.textBody.trim() },
      });
    }
  }
  return { duplicate: false, ignored: false, conversationId: conversation.id, messageId: message.id, status: conversation.status, triage };
}

export async function recordSupportAgentHeartbeat(input: {
  mailboxAddress: string;
  status: "RUNNING" | "IDLE" | "ERROR";
  scanned?: number;
  ignored?: number;
  result?: string;
  error?: string | null;
  intervalMs?: number;
}) {
  const shop = await configuredShop();
  const now = new Date();
  return prisma.supportMailbox.upsert({
    where: { shopId_address: { shopId: shop.id, address: canonicalEmail(input.mailboxAddress) } },
    update: {
      connectionStatus: input.status === "ERROR" ? "ERROR" : "CONNECTED",
      lastAgentRunAt: now,
      nextAgentRunAt: input.status === "RUNNING" ? null : new Date(now.getTime() + Math.max(60_000, input.intervalMs || 120_000)),
      lastAgentResult: (input.result || input.status).slice(0, 300),
      lastScanCount: Math.max(0, Number(input.scanned || 0)),
      ignoredMessageCount: Math.max(0, Number(input.ignored || 0)),
      lastError: input.error ? input.error.slice(0, 500) : null,
    },
    create: {
      shopId: shop.id,
      address: canonicalEmail(input.mailboxAddress),
      connectionStatus: input.status === "ERROR" ? "ERROR" : "CONNECTED",
      lastAgentRunAt: now,
      nextAgentRunAt: input.status === "RUNNING" ? null : new Date(now.getTime() + Math.max(60_000, input.intervalMs || 120_000)),
      lastAgentResult: (input.result || input.status).slice(0, 300),
      lastScanCount: Math.max(0, Number(input.scanned || 0)),
      ignoredMessageCount: Math.max(0, Number(input.ignored || 0)),
      lastError: input.error ? input.error.slice(0, 500) : null,
    },
  });
}

export async function draftSupportReply(conversationId: string, sessionToken?: string) {
  const conversation = await prisma.supportConversation.findUnique({
    where: { id: conversationId },
    include: { customer: true, mailbox: true, messages: { orderBy: { sentAt: "asc" }, take: 30 } },
  });
  if (!conversation) throw new Error("Support conversation not found.");
  const latestInbound = [...conversation.messages].reverse().find(message => message.direction === "INBOUND");
  if (!latestInbound) throw new Error("The conversation has no inbound customer message.");
  const policy = evaluateSupportPolicy(`${conversation.subject}\n${latestInbound.textBody}`);
  const orderNumber = latestInbound.textBody.match(/#?\d{4,}/)?.[0] || null;
  let orderContext: unknown = null;
  try {
    const orders = await shopify.supportOrderContext({ customerEmail: conversation.customer.email, orderName: orderNumber, sessionToken });
    orderContext = orders;
    const primary = orders[0];
    if (primary) {
      await prisma.supportConversation.update({ where: { id: conversation.id }, data: { shopifyOrderGid: primary.id, shopifyOrderName: primary.name } });
      await prisma.supportCustomer.update({
        where: { id: conversation.customer.id },
        data: { shopifyCustomerGid: primary.customer?.id || null, lifetimeOrders: primary.customer ? Number(primary.customer.numberOfOrders) : null },
      });
      await prisma.supportConversation.update({ where: { id: conversation.id }, data: { audienceType: "VERIFIED_CUSTOMER" } });
      await appendSupportEvidence({ conversationId: conversation.id, kind: "SHOPIFY_ORDER_SNAPSHOT", source: "SHOPIFY_ADMIN", occurredAt: new Date(), payload: orders });
    }
  } catch (error: any) {
    await appendSupportEvidence({ conversationId: conversation.id, kind: "ORDER_LOOKUP_FAILED", source: "SHOPIFY_ADMIN", occurredAt: new Date(), payload: { error: String(error?.message || error).slice(0, 300) } });
  }
  const examples = await prisma.supportVoiceExample.findMany({
    where: { shopId: conversation.shopId, qualityStatus: { in: ["LEARNED", "APPROVED"] } },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { customerMessage: true, ownerReply: true },
  });
  const decision = await generateSupportDecision({
    subject: conversation.subject,
    threadText: conversation.messages.map(message => `${message.direction}: ${message.textBody}`).join("\n\n"),
    ownerExamples: examples,
    orderContext,
    policy,
    audienceType: Array.isArray(orderContext) && orderContext.length > 0 ? "VERIFIED_CUSTOMER" : conversation.audienceType,
  });
  const canAutoSend = mayAutoSend({
    automationMode: conversation.mailbox.automationMode,
    policy,
    confidence: decision.confidence,
    hasVerifiedOrder: Array.isArray(orderContext) && orderContext.length > 0,
    hasUnverifiedClaims: decision.unverifiedClaims.length > 0,
  });
  const status = decision.decision === "ESCALATE" || policy.mustEscalate
    ? "ESCALATED"
    : canAutoSend
      ? "QUEUED_TO_SEND"
      : "PENDING_REVIEW";
  const draft = await prisma.supportDraft.create({
    data: {
      conversationId: conversation.id,
      status,
      decision: decision.decision,
      replyText: decision.replyText,
      model: decision.model,
      confidence: decision.confidence,
      reason: decision.reason,
      verifiedFactsJson: safeJson({ orderContext, factsUsed: decision.factsUsed }),
      policyFlagsJson: safeJson([...policy.flags, ...decision.unverifiedClaims.map(value => `UNVERIFIED:${value}`)]),
      sendAfter: canAutoSend ? new Date() : null,
    },
  });
  await prisma.supportConversation.update({
    where: { id: conversation.id },
    data: {
      status: status === "ESCALATED" ? "ESCALATED" : "OPEN",
      confidence: decision.confidence,
      topic: decision.topic || policy.topic,
      riskLevel: policy.riskLevel,
      escalationReason: status === "ESCALATED" ? (policy.flags.join(", ") || decision.reason) : null,
      nextActionAt: null,
    },
  });
  await appendSupportEvidence({ conversationId: conversation.id, kind: "AI_DECISION", source: "OPENROUTER", occurredAt: new Date(), payload: { draftId: draft.id, status, decision } });
  return draft;
}

export async function processSupportDeskCron() {
  if (workerEnvValue("SUPPORT_AI_DRAFTS_ENABLED") !== "true") return { processed: 0, disabled: true };
  const due = await prisma.supportConversation.findMany({
    where: { status: "OPEN", nextActionAt: { lte: new Date() }, drafts: { none: { status: { in: ["PENDING_REVIEW", "QUEUED_TO_SEND"] } } } },
    orderBy: { nextActionAt: "asc" },
    take: 10,
    select: { id: true },
  });
  const results = [];
  for (const item of due) {
    try {
      results.push({ id: item.id, ok: true, draft: await draftSupportReply(item.id) });
    } catch (error: any) {
      results.push({ id: item.id, ok: false, error: String(error?.message || error).slice(0, 200) });
    }
  }
  return { processed: results.length, disabled: false, results };
}
