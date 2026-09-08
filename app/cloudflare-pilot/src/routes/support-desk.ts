import { Router } from "express";
import prisma from "../lib/db.js";
import { supportD1 } from "../lib/support-d1.js";
import { workerEnvValue } from "../lib/shopify-config.js";
import { inspectSupportEmailDomain } from "../lib/support-deliverability.js";
import { summarizeSupportSendAuthorizations } from "../lib/support-analytics.js";
import { APPROVED_STORE_FACTS } from "../lib/support-replies.js";
import { appendSupportEvidence, draftSupportReply, ingestSupportMessage, recordSupportAgentHeartbeat, type SupportIngestInput } from "../services/support-desk.js";

export const supportAdminRouter = Router();
export const supportBridgeRouter = Router();

let deliverabilityCache: { domain: string; expiresAt: number; value: unknown } | null = null;

function customerSupportScope() {
  return {
    OR: [
      { messages: { some: { direction: "INBOUND" } } },
      { language: { in: ["HEBREW", "MIXED"] } },
      { shopifyOrderGid: { not: null } },
    ],
  };
}

function customerSupportConversationWhere(status?: string) {
  const statusFilter = status === "DELIVERY_FAILED"
    ? { drafts: { some: { status: "FAILED" } } }
    : status
      ? { status }
      : { status: { not: "CLOSED" } };
  return {
    AND: [
      statusFilter,
      customerSupportScope(),
    ],
  };
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function bearer(req: any): string {
  const header = String(req.get("authorization") || "");
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length || a.length === 0) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result |= a[index] ^ b[index];
  return result === 0;
}

supportBridgeRouter.use((req, res, next) => {
  const secret = workerEnvValue("SUPPORT_CONNECTOR_TOKEN");
  if (!secret || !constantTimeEqual(bearer(req), secret)) return res.status(401).json({ ok: false, error: "Unauthorized support connector." });
  next();
});

supportBridgeRouter.post("/ingest", async (req, res) => {
  try {
    const input = req.body as SupportIngestInput;
    const required = [input?.mailboxAddress, input?.customerEmail, input?.externalMessageId, input?.direction, input?.fromAddress, input?.subject, input?.textBody, input?.sentAt];
    if (required.some(value => typeof value !== "string" || !value.trim())) return res.status(400).json({ ok: false, error: "Required message fields are missing." });
    if (!Array.isArray(input.toAddresses) || !["INBOUND", "OUTBOUND"].includes(input.direction)) return res.status(400).json({ ok: false, error: "Invalid message direction or recipients." });
    return res.json({ ok: true, result: await ingestSupportMessage(input) });
  } catch (error: any) {
    return res.status(400).json({ ok: false, error: String(error?.message || error).slice(0, 300) });
  }
});

supportBridgeRouter.post("/heartbeat", async (req, res) => {
  try {
    const mailboxAddress = String(req.body?.mailboxAddress || "").trim();
    const status = String(req.body?.status || "");
    if (!mailboxAddress || !["RUNNING", "IDLE", "ERROR"].includes(status)) {
      return res.status(400).json({ ok: false, error: "mailboxAddress and a valid agent status are required." });
    }
    const mailbox = await recordSupportAgentHeartbeat({
      mailboxAddress,
      status: status as "RUNNING" | "IDLE" | "ERROR",
      scanned: Number(req.body?.scanned || 0),
      ignored: Number(req.body?.ignored || 0),
      result: String(req.body?.result || status),
      error: req.body?.error ? String(req.body.error) : null,
      intervalMs: Number(req.body?.intervalMs || 120000),
    });
    return res.json({ ok: true, mailbox });
  } catch (error: any) {
    return res.status(400).json({ ok: false, error: String(error?.message || error).slice(0, 300) });
  }
});

// Agent-facing support API. These routes intentionally reuse the same bearer
// boundary as the mailbox connector so an MCP agent never needs Shopify Admin
// session cookies or direct database credentials.
supportBridgeRouter.get("/status", async (_req, res) => {
  const db = supportD1();
  const [mailboxRows, countRows] = await db.batch([
    db.prepare('SELECT * FROM "SupportMailbox" ORDER BY "updatedAt" DESC'),
    db.prepare(`SELECT
      (SELECT COUNT(*) FROM "SupportConversation" WHERE "status" = 'OPEN') AS open,
      (SELECT COUNT(*) FROM "SupportConversation" WHERE "status" = 'NEEDS_TRIAGE') AS needsTriage,
      (SELECT COUNT(*) FROM "SupportConversation" WHERE "status" = 'ESCALATED') AS escalated,
      (SELECT COUNT(*) FROM "SupportDraft" WHERE "status" = 'QUEUED_TO_SEND') AS queued`),
  ]);
  const mailboxes = mailboxRows.results || [];
  const counts = (countRows.results?.[0] || {}) as Record<string, number>;
  res.setHeader("Cache-Control", "no-store");
  return res.json({ ok: true, mailboxes, counts: {
    open: Number(counts.open || 0),
    needsTriage: Number(counts.needsTriage || 0),
    escalated: Number(counts.escalated || 0),
    queued: Number(counts.queued || 0),
  } });
});

supportBridgeRouter.get("/delivery/pending-verification", async (_req, res) => {
  const db = supportD1();
  const rows = await db.prepare(`SELECT d."id", d."conversationId", d."sentAt"
    FROM "SupportDraft" d
    WHERE d."status" = 'SENT' AND d."sentAt" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "SupportEvidenceEvent" e
        WHERE e."conversationId" = d."conversationId"
          AND e."kind" = 'OUTBOUND_DELIVERY_VERIFIED'
          AND e."payloadJson" LIKE '%' || d."id" || '%'
      )
    ORDER BY d."sentAt" DESC LIMIT 50`).all<{ id: string; conversationId: string; sentAt: string }>();
  res.setHeader("Cache-Control", "no-store");
  return res.json({ ok: true, drafts: (rows.results || []).map(row => ({
    ...row,
    deterministicMessageId: `<support-draft-${row.id}@tigerbrandsglobal.com>`,
  })) });
});

supportBridgeRouter.post("/delivery/:id/verify-sent-copy", async (req, res) => {
  const draft = await prisma.supportDraft.findUnique({ where: { id: req.params.id } });
  if (!draft || draft.status !== "SENT" || !draft.sentAt) return res.status(404).json({ ok: false, error: "A sent support draft was not found." });
  const expectedMessageId = `<support-draft-${draft.id}@tigerbrandsglobal.com>`;
  if (String(req.body?.externalMessageId || "").trim() !== expectedMessageId || req.body?.sentFolderCopy !== true) {
    return res.status(400).json({ ok: false, error: "A verified Sent-folder copy and matching Message-ID are required." });
  }
  const db = supportD1();
  const existing = await db.prepare(`SELECT "id" FROM "SupportEvidenceEvent"
    WHERE "conversationId" = ? AND "kind" = 'OUTBOUND_DELIVERY_VERIFIED' AND "payloadJson" LIKE ? LIMIT 1`)
    .bind(draft.conversationId, `%${draft.id}%`).first<{ id: string }>();
  if (!existing) {
    await appendSupportEvidence({
      conversationId: draft.conversationId,
      kind: "OUTBOUND_DELIVERY_VERIFIED",
      source: "NAMECHEAP_IMAP_SENT",
      occurredAt: new Date(),
      payload: { externalMessageId: expectedMessageId, draftId: draft.id, sentFolderCopy: true, reconciled: true },
    });
  }
  await prisma.supportMessage.updateMany({
    where: { externalMessageId: expectedMessageId, direction: "OUTBOUND" },
    data: { source: "NAMECHEAP_SMTP_AND_IMAP_SENT", deliveryStatus: "SENT_COPY_VERIFIED" },
  });
  return res.json({ ok: true, duplicate: Boolean(existing) });
});

supportBridgeRouter.get("/conversations", async (req, res) => {
  const allowedStatuses = new Set(["OPEN", "NEEDS_TRIAGE", "ESCALATED", "WAITING_CUSTOMER", "CLOSED"]);
  const requestedStatus = typeof req.query.status === "string" ? req.query.status.toUpperCase() : "";
  const status = allowedStatuses.has(requestedStatus) ? requestedStatus : undefined;
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 25)));
  const rows = await prisma.supportConversation.findMany({
    where: customerSupportConversationWhere(status),
    orderBy: { updatedAt: "desc" },
    take: limit,
    include: {
      customer: { select: { email: true, displayName: true, riskLevel: true, lifetimeOrders: true } },
      messages: { orderBy: { sentAt: "desc" }, take: 1 },
      drafts: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  res.setHeader("Cache-Control", "no-store");
  return res.json({ ok: true, conversations: rows });
});

supportBridgeRouter.get("/conversations/:id", async (req, res) => {
  const row = await prisma.supportConversation.findUnique({
    where: { id: req.params.id },
    include: {
      customer: true,
      mailbox: { select: { address: true, automationMode: true, replyDelayMinutes: true } },
      messages: { orderBy: { sentAt: "asc" } },
      drafts: { orderBy: { createdAt: "desc" } },
      evidence: { orderBy: { occurredAt: "asc" } },
    },
  });
  if (!row) return res.status(404).json({ ok: false, error: "Conversation not found." });
  res.setHeader("Cache-Control", "no-store");
  return res.json({ ok: true, conversation: row });
});

supportBridgeRouter.post("/conversations/:id/draft", async (req, res) => {
  try {
    const existing = await prisma.supportDraft.findFirst({
      where: { conversationId: req.params.id, status: { in: ["PENDING_REVIEW", "QUEUED_TO_SEND", "SENDING"] } },
      orderBy: { createdAt: "desc" },
    });
    if (existing) return res.json({ ok: true, reused: true, draft: existing });
    return res.json({ ok: true, reused: false, draft: await draftSupportReply(req.params.id) });
  } catch (error: any) {
    return res.status(400).json({ ok: false, error: String(error?.message || error).slice(0, 300) });
  }
});

supportBridgeRouter.post("/drafts/:id/approve", async (req, res) => {
  // A connector/agent must make the consequential queue-for-send decision
  // explicit. Merely generating or editing a draft can never send an email.
  if (req.body?.confirmSend !== true) {
    return res.status(400).json({ ok: false, error: "confirmSend=true is required to queue an external email." });
  }
  const replyText = String(req.body?.replyText || "").trim();
  if (!replyText) return res.status(400).json({ ok: false, error: "Reply text is required." });
  const existing = await prisma.supportDraft.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ ok: false, error: "Support draft not found." });
  if (existing.sentAt || ["QUEUED_TO_SEND", "SENDING", "SENT"].includes(existing.status)) {
    return res.status(409).json({ ok: false, error: "This draft is already queued or sent." });
  }
  const draft = await prisma.supportDraft.update({
    where: { id: existing.id },
    data: { replyText, status: "QUEUED_TO_SEND", sendAfter: new Date(), claimedAt: null, lastDeliveryError: null },
  });
  await appendSupportEvidence({
    conversationId: draft.conversationId,
    kind: "DRAFT_APPROVED_FOR_SEND",
    source: "SUPPORT_AGENT_API",
    occurredAt: new Date(),
    payload: { draftId: draft.id, approvedReplyText: replyText },
  });
  await appendSupportEvidence({
    conversationId: draft.conversationId,
    kind: "SEND_AUTHORIZED",
    source: "SUPPORT_AGENT_API",
    occurredAt: new Date(),
    payload: { draftId: draft.id, actor: "AGENT_API" },
  });
  return res.json({ ok: true, draft });
});

supportBridgeRouter.post("/outbox/claim", async (_req, res) => {
  const staleBefore = new Date(Date.now() - 15 * 60000);
  await prisma.supportDraft.updateMany({
    where: { status: "SENDING", claimedAt: { lt: staleBefore }, sentAt: null },
    data: { status: "QUEUED_TO_SEND", claimedAt: null },
  });
  const candidate = await prisma.supportDraft.findFirst({
    where: { status: "QUEUED_TO_SEND", OR: [{ sendAfter: null }, { sendAfter: { lte: new Date() } }] },
    orderBy: { createdAt: "asc" },
    include: { conversation: { include: { customer: true, mailbox: true, messages: { orderBy: { sentAt: "desc" }, take: 1 } } } },
  });
  if (!candidate) return res.json({ ok: true, draft: null });
  const claimed = await prisma.supportDraft.updateMany({
    where: { id: candidate.id, status: "QUEUED_TO_SEND" },
    data: { status: "SENDING", claimedAt: new Date(), attemptCount: { increment: 1 }, lastDeliveryError: null },
  });
  if (claimed.count !== 1) return res.status(409).json({ ok: false, error: "The draft was claimed by another bridge worker." });
  res.setHeader("Cache-Control", "no-store");
  return res.json({ ok: true, draft: {
    id: candidate.id,
    replyText: candidate.replyText,
    to: candidate.conversation.customer.email,
    from: candidate.conversation.mailbox.address,
    subject: /^re:/i.test(candidate.conversation.subject) ? candidate.conversation.subject : `Re: ${candidate.conversation.subject}`,
    inReplyTo: candidate.conversation.messages[0]?.externalMessageId || null,
    conversationId: candidate.conversation.id,
    deterministicMessageId: `<support-draft-${candidate.id}@tigerbrandsglobal.com>`,
  } });
});

supportBridgeRouter.post("/outbox/:id/sent", async (req, res) => {
  const draft = await prisma.supportDraft.findUnique({ where: { id: req.params.id }, include: { conversation: { include: { customer: true, mailbox: true } } } });
  if (!draft || !["SENDING", "QUEUED_TO_SEND"].includes(draft.status)) return res.status(404).json({ ok: false, error: "Claimed support draft not found." });
  const externalMessageId = String(req.body?.externalMessageId || "").trim();
  const providerMessageId = String(req.body?.providerMessageId || "").trim() || null;
  const deliveryProof = req.body?.deliveryProof && typeof req.body.deliveryProof === "object"
    ? req.body.deliveryProof as Record<string, unknown>
    : null;
  const sentFolderCopyVerified = deliveryProof?.sentFolderCopy === true;
  const sentAt = new Date(req.body?.sentAt || Date.now());
  if (!externalMessageId || Number.isNaN(sentAt.getTime())) return res.status(400).json({ ok: false, error: "externalMessageId and a valid sentAt are required." });
  await prisma.$transaction([
    prisma.supportDraft.update({ where: { id: draft.id }, data: { status: "SENT", sentAt, claimedAt: null, lastDeliveryError: null } }),
    prisma.supportMessage.create({ data: {
      conversationId: draft.conversationId,
      externalMessageId,
      direction: "OUTBOUND",
      fromAddress: draft.conversation.mailbox.address,
      toAddressesJson: JSON.stringify([draft.conversation.customer.email]),
      subject: draft.conversation.subject,
      textBody: draft.replyText,
      sentAt,
      source: sentFolderCopyVerified ? "NAMECHEAP_SMTP_AND_IMAP_SENT" : "NAMECHEAP_SMTP",
      deliveryStatus: sentFolderCopyVerified ? "SENT_COPY_VERIFIED" : "SENT",
      aiGenerated: true,
    } }),
    prisma.supportConversation.update({ where: { id: draft.conversationId }, data: { status: "WAITING_CUSTOMER", lastAgentMessageAt: sentAt } }),
  ]);
  await appendSupportEvidence({
    conversationId: draft.conversationId,
    kind: "OUTBOUND_EMAIL",
    source: sentFolderCopyVerified ? "NAMECHEAP_SMTP_AND_IMAP_SENT" : "NAMECHEAP_SMTP",
    occurredAt: sentAt,
    payload: { externalMessageId, providerMessageId, draftId: draft.id, subject: draft.conversation.subject, to: draft.conversation.customer.email, textBody: draft.replyText, deliveryProof },
  });
  if (sentFolderCopyVerified) {
    await appendSupportEvidence({
      conversationId: draft.conversationId,
      kind: "OUTBOUND_DELIVERY_VERIFIED",
      source: "NAMECHEAP_IMAP_SENT",
      occurredAt: sentAt,
      payload: { externalMessageId, providerMessageId, draftId: draft.id, sentFolderCopy: true },
    });
  }
  return res.json({ ok: true });
});

supportBridgeRouter.post("/outbox/:id/failed", async (req, res) => {
  const error = String(req.body?.error || "SMTP delivery failed.").slice(0, 500);
  const updated = await prisma.supportDraft.updateMany({
    where: { id: req.params.id, status: "SENDING", sentAt: null },
    data: { status: "FAILED", claimedAt: null, lastDeliveryError: error },
  });
  return res.status(updated.count === 1 ? 200 : 404).json({ ok: updated.count === 1 });
});

supportAdminRouter.get("/support/overview", async (_req, res) => {
  const [mailboxes, open, escalated, pendingReview, voicePendingReview, approvedVoiceExamples, queuedReplies, sentReplies, failedReplies, verifiedSentCopies] = await Promise.all([
    prisma.supportMailbox.findMany({ orderBy: { updatedAt: "desc" } }),
    prisma.supportConversation.count({ where: customerSupportConversationWhere("OPEN") }),
    prisma.supportConversation.count({ where: customerSupportConversationWhere("ESCALATED") }),
    prisma.supportDraft.count({ where: { status: "PENDING_REVIEW" } }),
    prisma.supportVoiceExample.count({ where: { qualityStatus: { in: ["LEARNED", "PENDING_REVIEW"] } } }),
    prisma.supportVoiceExample.count({ where: { qualityStatus: "APPROVED" } }),
    prisma.supportDraft.count({ where: { status: { in: ["QUEUED_TO_SEND", "SENDING"] } } }),
    prisma.supportDraft.count({ where: { status: "SENT" } }),
    prisma.supportDraft.count({ where: { status: "FAILED" } }),
    prisma.supportEvidenceEvent.count({ where: { kind: "OUTBOUND_DELIVERY_VERIFIED" } }),
  ]);
  res.setHeader("Cache-Control", "no-store");
  return res.json({ ok: true, mailboxes, counts: { open, escalated, pendingReview, voicePendingReview, approvedVoiceExamples, queuedReplies, sentReplies, failedReplies, verifiedSentCopies } });
});

supportAdminRouter.get("/support/voice-examples", async (req, res) => {
  const requestedStatus = typeof req.query.status === "string" ? req.query.status : "PENDING_REVIEW";
  const qualityStatuses = requestedStatus === "PENDING_REVIEW" ? ["LEARNED", "PENDING_REVIEW"] : [requestedStatus];
  const allowed = new Set(["LEARNED", "PENDING_REVIEW", "APPROVED", "REJECTED"]);
  if (qualityStatuses.some(status => !allowed.has(status))) return res.status(400).json({ ok: false, error: "Invalid voice-example status." });
  const examples = await prisma.supportVoiceExample.findMany({
    where: { qualityStatus: { in: qualityStatuses } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, topic: true, customerMessage: true, ownerReply: true, qualityStatus: true, createdAt: true },
  });
  res.setHeader("Cache-Control", "no-store");
  return res.json({ ok: true, examples });
});

supportAdminRouter.get("/support/knowledge", async (_req, res) => {
  const [approvedVoiceExamples, pendingVoiceExamples] = await Promise.all([
    prisma.supportVoiceExample.count({ where: { qualityStatus: "APPROVED" } }),
    prisma.supportVoiceExample.count({ where: { qualityStatus: { in: ["LEARNED", "PENDING_REVIEW"] } } }),
  ]);
  res.setHeader("Cache-Control", "no-store");
  return res.json({
    ok: true,
    approvedStoreFacts: APPROVED_STORE_FACTS,
    voice: { approved: approvedVoiceExamples, pendingReview: pendingVoiceExamples },
    policy: {
      automatic: ["General delivery questions", "Verified order-status questions"],
      reviewRequired: ["Product use or result questions", "Delivery disputes", "Uncertain customer or order identity"],
      alwaysEscalate: ["Refunds or cancellations", "Address changes", "Chargebacks", "Legal, safety, fraud or privacy concerns"],
    },
  });
});

supportAdminRouter.get("/support/analytics", async (req, res) => {
  const days = Math.min(90, Math.max(1, Number.parseInt(String(req.query.days || "7"), 10) || 7));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const conversations = await prisma.supportConversation.findMany({
    where: {
      AND: [
        customerSupportScope(),
        { messages: { some: { direction: "INBOUND", sentAt: { gte: since } } } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 500,
    include: {
      messages: { orderBy: { sentAt: "asc" }, take: 100 },
      drafts: { where: { createdAt: { gte: since } }, orderBy: { createdAt: "asc" } },
      evidence: { where: { kind: "SEND_AUTHORIZED", occurredAt: { gte: since } }, orderBy: { occurredAt: "asc" } },
    },
  });

  const responseMinutes: number[] = [];
  const topicCounts = new Map<string, number>();
  const customerCounts = new Map<string, number>();
  let answered = 0;
  let escalated = 0;
  let waiting = 0;
  let aiRepliesSent = 0;
  let automaticAiRepliesSent = 0;
  let ownerApprovedAiRepliesSent = 0;
  let agentApprovedAiRepliesSent = 0;
  let unclassifiedAiRepliesSent = 0;
  let deliveryFailures = 0;

  for (const conversation of conversations) {
    const firstInbound = conversation.messages.find(message => message.direction === "INBOUND" && message.sentAt >= since);
    const firstOutbound = firstInbound && conversation.messages.find(message => message.direction === "OUTBOUND" && message.sentAt > firstInbound.sentAt);
    if (firstInbound && firstOutbound) {
      answered += 1;
      responseMinutes.push(Math.max(0, (firstOutbound.sentAt.getTime() - firstInbound.sentAt.getTime()) / 60000));
    }
    if (conversation.status === "ESCALATED") escalated += 1;
    if (conversation.status === "WAITING_CUSTOMER") waiting += 1;
    const sendSummary = summarizeSupportSendAuthorizations(conversation.drafts, conversation.evidence, since);
    aiRepliesSent += sendSummary.total;
    automaticAiRepliesSent += sendSummary.automatic;
    ownerApprovedAiRepliesSent += sendSummary.ownerApproved;
    agentApprovedAiRepliesSent += sendSummary.agentApproved;
    unclassifiedAiRepliesSent += sendSummary.unclassified;
    deliveryFailures += conversation.drafts.filter(draft => draft.status === "FAILED").length;
    topicCounts.set(conversation.topic, (topicCounts.get(conversation.topic) || 0) + 1);
    customerCounts.set(conversation.customerId, (customerCounts.get(conversation.customerId) || 0) + 1);
  }

  const verifiedSentCopies = await prisma.supportEvidenceEvent.count({
    where: { kind: "OUTBOUND_DELIVERY_VERIFIED", occurredAt: { gte: since } },
  });
  const repeatCustomers = [...customerCounts.values()].filter(count => count > 1).length;
  const topTopics = [...topicCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6)
    .map(([topic, count]) => ({ topic, count, share: conversations.length ? count / conversations.length : 0 }));

  res.setHeader("Cache-Control", "no-store");
  return res.json({
    ok: true,
    range: { days, from: since.toISOString(), to: new Date().toISOString(), timeZone: "Asia/Jerusalem" },
    metrics: {
      conversations: conversations.length,
      answered,
      waiting,
      escalated,
      escalationRate: conversations.length ? escalated / conversations.length : 0,
      medianFirstResponseMinutes: median(responseMinutes),
      aiRepliesSent,
      automaticAiRepliesSent,
      ownerApprovedAiRepliesSent,
      agentApprovedAiRepliesSent,
      unclassifiedAiRepliesSent,
      deliveryFailures,
      verifiedSentCopies,
      repeatCustomers,
    },
    topTopics,
    quality: {
      source: "Namecheap messages, Shopify-backed support context and the internal support evidence ledger",
      coverage: conversations.length >= 500 ? "CAPPED" : "COMPLETE_FOR_RANGE",
      note: "Automatic and owner-approved sends are separated from the authorization evidence ledger. Older sends without an authorization record remain unclassified rather than being guessed.",
    },
  });
});

supportAdminRouter.patch("/support/voice-examples/:id", async (req, res) => {
  const qualityStatus = String(req.body?.qualityStatus || "");
  if (!new Set(["APPROVED", "REJECTED"]).has(qualityStatus)) return res.status(400).json({ ok: false, error: "Voice examples may only be approved or rejected." });
  const example = await prisma.supportVoiceExample.update({
    where: { id: req.params.id },
    data: { qualityStatus },
    select: { id: true, qualityStatus: true },
  });
  return res.json({ ok: true, example });
});

supportAdminRouter.get("/support/deliverability", async (_req, res) => {
  try {
    const mailbox = await prisma.supportMailbox.findFirst({ orderBy: { updatedAt: "desc" }, select: { address: true } });
    const domain = String(mailbox?.address || "").split("@").at(-1) || "";
    if (!domain) return res.status(404).json({ ok: false, error: "A support mailbox has not been configured yet." });
    if (!deliverabilityCache || deliverabilityCache.domain !== domain || deliverabilityCache.expiresAt <= Date.now()) {
      deliverabilityCache = { domain, expiresAt: Date.now() + 5 * 60_000, value: await inspectSupportEmailDomain(domain) };
    }
    res.setHeader("Cache-Control", "no-store");
    return res.json({ ok: true, deliverability: deliverabilityCache.value });
  } catch (error: any) {
    return res.status(502).json({ ok: false, error: String(error?.message || error).slice(0, 300) });
  }
});

supportAdminRouter.get("/support/conversations", async (req, res) => {
  const status = typeof req.query.status === "string" && req.query.status !== "ALL" ? req.query.status : undefined;
  const rows = await prisma.supportConversation.findMany({
    where: customerSupportConversationWhere(status),
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: {
      customer: true,
      drafts: { orderBy: { createdAt: "desc" }, take: 1 },
      messages: { orderBy: { sentAt: "desc" }, take: 1 },
    },
  });
  res.setHeader("Cache-Control", "no-store");
  return res.json({ ok: true, conversations: rows });
});

supportAdminRouter.get("/support/conversations/:id", async (req, res) => {
  const row = await prisma.supportConversation.findUnique({
    where: { id: req.params.id },
    include: {
      customer: true,
      mailbox: true,
      messages: { orderBy: { sentAt: "asc" } },
      drafts: { orderBy: { createdAt: "desc" } },
      evidence: { orderBy: { occurredAt: "asc" } },
    },
  });
  if (!row) return res.status(404).json({ ok: false, error: "Conversation not found." });
  res.setHeader("Cache-Control", "no-store");
  return res.json({ ok: true, conversation: row });
});

supportAdminRouter.post("/support/conversations/:id/draft", async (req, res) => {
  try {
    return res.json({ ok: true, draft: await draftSupportReply(req.params.id, bearer(req)) });
  } catch (error: any) {
    return res.status(400).json({ ok: false, error: String(error?.message || error).slice(0, 300) });
  }
});

supportAdminRouter.post("/support/drafts/:id/approve", async (req, res) => {
  const replyText = String(req.body?.replyText || "").trim();
  if (!replyText) return res.status(400).json({ ok: false, error: "Reply text is required." });
  const updated = await prisma.supportDraft.updateMany({
    where: { id: req.params.id, status: { in: ["PENDING_REVIEW", "ESCALATED", "FAILED"] }, sentAt: null },
    data: { replyText, status: "QUEUED_TO_SEND", sendAfter: new Date(), claimedAt: null, lastDeliveryError: null },
  });
  if (updated.count !== 1) return res.status(409).json({ ok: false, error: "This draft is already queued or sent." });
  const draft = await prisma.supportDraft.findUnique({ where: { id: req.params.id } });
  if (draft) {
    await appendSupportEvidence({
      conversationId: draft.conversationId,
      kind: "SEND_AUTHORIZED",
      source: "SUPPORT_ADMIN",
      occurredAt: new Date(),
      payload: { draftId: draft.id, actor: "OWNER_ADMIN" },
    });
  }
  return res.json({ ok: true, draft });
});

supportAdminRouter.post("/support/drafts/:id/reject", async (req, res) => {
  const draft = await prisma.supportDraft.update({ where: { id: req.params.id }, data: { status: "REJECTED", reason: String(req.body?.reason || "Rejected by owner.").slice(0, 500) } });
  return res.json({ ok: true, draft });
});

supportAdminRouter.patch("/support/mailboxes/:id", async (req, res) => {
  const automationMode = String(req.body?.automationMode || "");
  const replyDelayMinutes = Number(req.body?.replyDelayMinutes);
  if (!new Set(["OFF", "DRAFT_ONLY", "AUTOSEND_LOW_RISK"]).has(automationMode)) return res.status(400).json({ ok: false, error: "Invalid automation mode." });
  if (!Number.isInteger(replyDelayMinutes) || replyDelayMinutes < 1 || replyDelayMinutes > 60) return res.status(400).json({ ok: false, error: "Reply delay must be 1–60 minutes." });
  const mailbox = await prisma.supportMailbox.update({ where: { id: req.params.id }, data: { automationMode, replyDelayMinutes } });
  return res.json({ ok: true, mailbox });
});
