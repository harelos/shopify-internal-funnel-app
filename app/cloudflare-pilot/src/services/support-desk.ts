import prisma from "../lib/db.js";
import { ShopifyAdminClient } from "../lib/shopify-admin.js";
import { workerEnvValue } from "../lib/shopify-config.js";
import { generateSupportDecision } from "../lib/support-ai.js";
import { evaluateSupportPolicy, mayAutoSend } from "../lib/support-policy.js";
import { extractSupportOrderNumber } from "../lib/support-email.js";
import { triageMailboxMessage, type SupportTriageClass } from "../lib/support-triage.js";
import { supportD1, supportId, supportNow } from "../lib/support-d1.js";

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
  const db = supportD1();
  const existing = await db.prepare('SELECT "id", "domain" FROM "Shop" WHERE "domain" = ? LIMIT 1').bind(domain).first<{ id: string; domain: string }>();
  if (existing) return existing;
  const id = supportId("shop");
  await db.prepare('INSERT OR IGNORE INTO "Shop" ("id", "domain") VALUES (?, ?)').bind(id, domain).run();
  return (await db.prepare('SELECT "id", "domain" FROM "Shop" WHERE "domain" = ? LIMIT 1').bind(domain).first<{ id: string; domain: string }>()) || { id, domain };
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
  const db = supportD1();
  const payloadJson = safeJson(input.payload);
  const previous = await db.prepare(`SELECT "contentHash" FROM "SupportEvidenceEvent"
    WHERE "conversationId" = ? ORDER BY "occurredAt" DESC, "createdAt" DESC LIMIT 1`)
    .bind(input.conversationId).first<{ contentHash: string }>();
  const previousHash = previous?.contentHash || null;
  const id = supportId("evidence");
  const contentHash = await sha256(`${previousHash || "GENESIS"}\n${payloadJson}`);
  await db.prepare(`INSERT INTO "SupportEvidenceEvent"
    ("id", "conversationId", "kind", "source", "previousHash", "contentHash", "payloadJson", "occurredAt", "createdAt")
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, input.conversationId, input.kind, input.source, previousHash, contentHash, payloadJson, input.occurredAt.toISOString(), supportNow()).run();
  return { id, conversationId: input.conversationId, kind: input.kind, source: input.source, previousHash, contentHash, payloadJson, occurredAt: input.occurredAt };
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
  const db = supportD1();
  const existingMessage = await db.prepare('SELECT "id", "conversationId", "textBody" FROM "SupportMessage" WHERE "externalMessageId" = ? LIMIT 1')
    .bind(input.externalMessageId).first<{ id: string; conversationId: string; textBody: string }>();
  if (existingMessage) {
    const cleanerBody = input.textBody.trim();
    if (cleanerBody.length >= 2 && existingMessage.textBody.length > cleanerBody.length * 1.5) {
      await db.prepare('UPDATE "SupportMessage" SET "textBody" = ? WHERE "id" = ?').bind(cleanerBody, existingMessage.id).run();
    }
    return { duplicate: true, conversationId: existingMessage.conversationId, messageId: existingMessage.id };
  }

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
  if (triage.classification === "IGNORE") return { duplicate: false, ignored: true, triage };

  const policy = evaluateSupportPolicy(`${input.subject}\n${input.textBody}`);
  const now = supportNow();
  const mailboxAddress = canonicalEmail(input.mailboxAddress);
  let mailbox = await db.prepare('SELECT * FROM "SupportMailbox" WHERE "shopId" = ? AND "address" = ? LIMIT 1')
    .bind(shop.id, mailboxAddress).first<any>();
  if (!mailbox) {
    const mailboxId = supportId("mailbox");
    await db.prepare(`INSERT OR IGNORE INTO "SupportMailbox"
      ("id", "shopId", "address", "connectionStatus", "lastSyncAt", "createdAt", "updatedAt")
      VALUES (?, ?, ?, 'CONNECTED', ?, ?, ?)`)
      .bind(mailboxId, shop.id, mailboxAddress, now, now, now).run();
    mailbox = await db.prepare('SELECT * FROM "SupportMailbox" WHERE "shopId" = ? AND "address" = ? LIMIT 1')
      .bind(shop.id, mailboxAddress).first<any>();
  }
  if (!mailbox) throw new Error("Support mailbox could not be created.");
  await db.prepare(`UPDATE "SupportMailbox" SET "connectionStatus" = 'CONNECTED', "lastSyncAt" = ?, "lastError" = NULL, "updatedAt" = ? WHERE "id" = ?`)
    .bind(now, now, mailbox.id).run();

  let customer = await db.prepare('SELECT * FROM "SupportCustomer" WHERE "shopId" = ? AND "email" = ? LIMIT 1')
    .bind(shop.id, email).first<any>();
  if (!customer) {
    const customerId = supportId("customer");
    await db.prepare(`INSERT OR IGNORE INTO "SupportCustomer"
      ("id", "shopId", "email", "displayName", "riskLevel", "riskReasonsJson", "createdAt", "updatedAt")
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(customerId, shop.id, email, input.customerName?.trim() || null, policy.riskLevel, safeJson(policy.flags), now, now).run();
    customer = await db.prepare('SELECT * FROM "SupportCustomer" WHERE "shopId" = ? AND "email" = ? LIMIT 1')
      .bind(shop.id, email).first<any>();
  }
  if (!customer) throw new Error("Support customer could not be created.");
  await db.prepare(`UPDATE "SupportCustomer" SET
    "displayName" = COALESCE(?, "displayName"), "riskLevel" = ?, "riskReasonsJson" = ?, "updatedAt" = ?
    WHERE "id" = ?`)
    .bind(input.customerName?.trim() || null, policy.riskLevel, safeJson(policy.flags), now, customer.id).run();

  const externalThreadKey = threadKey(input);
  const triageNeedsReview = triage.classification === "REVIEW";
  const audienceType = triage.classification === "SALES_QUESTION" ? "PROSPECT" : "UNVERIFIED_CUSTOMER";
  const status = input.direction === "INBOUND" ? (policy.mustEscalate ? "ESCALATED" : triageNeedsReview ? "NEEDS_TRIAGE" : "OPEN") : "WAITING_CUSTOMER";
  const nextActionAt = input.direction === "INBOUND" && !policy.mustEscalate && !triageNeedsReview
    ? new Date(sentAt.getTime() + Number(mailbox.replyDelayMinutes || 5) * 60000).toISOString()
    : null;
  let conversation = await db.prepare('SELECT * FROM "SupportConversation" WHERE "shopId" = ? AND "externalThreadKey" = ? LIMIT 1')
    .bind(shop.id, externalThreadKey).first<any>();
  if (!conversation) {
    const conversationId = supportId("conversation");
    await db.prepare(`INSERT OR IGNORE INTO "SupportConversation"
      ("id", "shopId", "mailboxId", "customerId", "externalThreadKey", "subject", "status", "priority", "topic", "audienceType", "triageStatus", "triageReason", "language", "riskLevel", "escalationReason", "nextActionAt", "lastCustomerMessageAt", "lastAgentMessageAt", "createdAt", "updatedAt")
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        conversationId, shop.id, mailbox.id, customer.id, externalThreadKey, input.subject || "Customer support", status,
        policy.priority, policy.topic, audienceType, triageNeedsReview ? "NEEDS_REVIEW" : "ACCEPTED",
        triage.reasons.join(", ") || null, triage.language, policy.riskLevel,
        policy.mustEscalate ? policy.flags.join(", ") : null, nextActionAt,
        input.direction === "INBOUND" ? sentAt.toISOString() : null,
        input.direction === "OUTBOUND" ? sentAt.toISOString() : null,
        now, now,
      ).run();
    conversation = await db.prepare('SELECT * FROM "SupportConversation" WHERE "shopId" = ? AND "externalThreadKey" = ? LIMIT 1')
      .bind(shop.id, externalThreadKey).first<any>();
  } else {
    await db.prepare(`UPDATE "SupportConversation" SET
      "subject" = ?, "status" = ?, "priority" = ?, "topic" = ?, "audienceType" = ?,
      "triageStatus" = ?, "triageReason" = ?, "language" = ?, "riskLevel" = ?, "escalationReason" = ?,
      "lastCustomerMessageAt" = CASE WHEN ? = 'INBOUND' THEN ? ELSE "lastCustomerMessageAt" END,
      "lastAgentMessageAt" = CASE WHEN ? = 'OUTBOUND' THEN ? ELSE "lastAgentMessageAt" END,
      "nextActionAt" = ?, "updatedAt" = ? WHERE "id" = ?`)
      .bind(
        input.subject || "Customer support", status, policy.priority, policy.topic, audienceType,
        triageNeedsReview ? "NEEDS_REVIEW" : "ACCEPTED", triage.reasons.join(", ") || null,
        triage.language, policy.riskLevel, policy.mustEscalate ? policy.flags.join(", ") : null,
        input.direction, sentAt.toISOString(), input.direction, sentAt.toISOString(), nextActionAt, now, conversation.id,
      ).run();
    conversation = { ...conversation, status };
  }
  if (!conversation) throw new Error("Support conversation could not be created.");

  const messageId = supportId("message");
  await db.prepare(`INSERT INTO "SupportMessage"
    ("id", "conversationId", "externalMessageId", "direction", "fromAddress", "toAddressesJson", "subject", "textBody", "sentAt", "source", "deliveryStatus", "aiGenerated", "triageClass", "triageScore", "triageReasonsJson", "inReplyTo", "referencesJson", "attachmentsJson", "createdAt")
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      messageId, conversation.id, input.externalMessageId, input.direction, canonicalEmail(input.fromAddress),
      safeJson(input.toAddresses.map(canonicalEmail)), input.subject || "Customer support", input.textBody.trim(), sentAt.toISOString(),
      input.source || "IMAP", input.direction === "OUTBOUND" ? "SENT" : "RECEIVED", triage.classification,
      triage.confidence, safeJson(triage.reasons), input.inReplyTo || null, safeJson(input.references || []),
      safeJson(input.attachments || []), now,
    ).run();
  await appendSupportEvidence({
    conversationId: conversation.id,
    kind: input.direction === "INBOUND" ? "INBOUND_EMAIL" : "OUTBOUND_EMAIL",
    source: input.source || "IMAP",
    occurredAt: sentAt,
    payload: { externalMessageId: input.externalMessageId, subject: input.subject, from: input.fromAddress, to: input.toAddresses, textBody: input.textBody, attachments: input.attachments || [] },
  });

  if (input.direction === "OUTBOUND") {
    const inbound = await db.prepare(`SELECT "externalMessageId", "textBody" FROM "SupportMessage"
      WHERE "conversationId" = ? AND "direction" = 'INBOUND' AND "sentAt" <= ? ORDER BY "sentAt" DESC LIMIT 1`)
      .bind(conversation.id, sentAt.toISOString()).first<any>();
    if (inbound) {
      await db.prepare(`INSERT INTO "SupportVoiceExample"
        ("id", "shopId", "inboundExternalId", "outboundExternalId", "topic", "customerMessage", "ownerReply", "qualityStatus", "createdAt")
        VALUES (?, ?, ?, ?, ?, ?, ?, 'LEARNED', ?)
        ON CONFLICT("shopId", "inboundExternalId", "outboundExternalId") DO UPDATE SET
          "ownerReply" = excluded."ownerReply", "topic" = excluded."topic"`)
        .bind(supportId("voice"), shop.id, inbound.externalMessageId, input.externalMessageId, policy.topic, inbound.textBody, input.textBody.trim(), now).run();
    }
  }
  return { duplicate: false, ignored: false, conversationId: conversation.id, messageId, status, triage };
}

async function ingestSupportMessagePrisma(input: SupportIngestInput) {
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
  const db = supportD1();
  const now = supportNow();
  const address = canonicalEmail(input.mailboxAddress);
  const connectionStatus = input.status === "ERROR" ? "ERROR" : "CONNECTED";
  const nextAgentRunAt = input.status === "RUNNING" ? null : new Date(Date.now() + Math.max(60_000, input.intervalMs || 120_000)).toISOString();
  const result = (input.result || input.status).slice(0, 300);
  const scanned = Math.max(0, Number(input.scanned || 0));
  const ignored = Math.max(0, Number(input.ignored || 0));
  const error = input.error ? input.error.slice(0, 500) : null;
  const existing = await db.prepare('SELECT "id" FROM "SupportMailbox" WHERE "shopId" = ? AND "address" = ? LIMIT 1').bind(shop.id, address).first<{ id: string }>();
  const mailboxId = existing?.id || supportId("mailbox");
  if (existing) {
    await db.prepare(`UPDATE "SupportMailbox" SET
      "connectionStatus" = ?, "lastAgentRunAt" = ?, "nextAgentRunAt" = ?,
      "lastAgentResult" = ?, "lastScanCount" = ?, "ignoredMessageCount" = ?,
      "lastError" = ?, "updatedAt" = ? WHERE "id" = ?`)
      .bind(connectionStatus, now, nextAgentRunAt, result, scanned, ignored, error, now, mailboxId).run();
  } else {
    await db.prepare(`INSERT INTO "SupportMailbox"
      ("id", "shopId", "address", "connectionStatus", "lastAgentRunAt", "nextAgentRunAt", "lastAgentResult", "lastScanCount", "ignoredMessageCount", "lastError", "createdAt", "updatedAt")
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(mailboxId, shop.id, address, connectionStatus, now, nextAgentRunAt, result, scanned, ignored, error, now, now).run();
  }
  return db.prepare('SELECT * FROM "SupportMailbox" WHERE "id" = ? LIMIT 1').bind(mailboxId).first();
}

export async function draftSupportReply(conversationId: string, sessionToken?: string) {
  const conversation = await prisma.supportConversation.findUnique({
    where: { id: conversationId },
    include: { customer: true, mailbox: true, messages: { orderBy: { sentAt: "asc" }, take: 30 } },
  });
  if (!conversation) throw new Error("Support conversation not found.");
  const latestMessage = conversation.messages.at(-1);
  if (!latestMessage || latestMessage.direction !== "INBOUND") throw new Error("There is no unanswered inbound customer message.");
  const latestInbound = [...conversation.messages].reverse().find(message => message.direction === "INBOUND");
  if (!latestInbound) throw new Error("The conversation has no inbound customer message.");
  const policy = evaluateSupportPolicy(`${conversation.subject}\n${latestInbound.textBody}`);
  const orderNumber = extractSupportOrderNumber(conversation.subject, latestInbound.textBody);
  let orderContext: unknown = null;
  try {
    const orders = await shopify.supportOrderContext({ customerEmail: conversation.customer.email, orderName: orderNumber, sessionToken });
    orderContext = orders;
    const primary = orders[0];
    if (primary) {
      await prisma.supportConversation.update({ where: { id: conversation.id }, data: { shopifyOrderGid: primary.id, shopifyOrderName: primary.name } });
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
    threadText: conversation.messages.slice(-12).map(message => `${message.direction}: ${message.textBody.slice(0, 4000)}`).join("\n\n").slice(-16000),
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
    messageAgeMinutes: Math.max(0, (Date.now() - latestInbound.sentAt.getTime()) / 60000),
    latestMessageIsInbound: latestMessage.direction === "INBOUND",
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
