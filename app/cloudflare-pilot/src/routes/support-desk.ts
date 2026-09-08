import { Router } from "express";
import prisma from "../lib/db.js";
import { supportD1 } from "../lib/support-d1.js";
import { workerEnvValue } from "../lib/shopify-config.js";
import { inspectSupportEmailDomain } from "../lib/support-deliverability.js";
import { appendSupportEvidence, draftSupportReply, ingestSupportMessage, recordSupportAgentHeartbeat, type SupportIngestInput } from "../services/support-desk.js";

export const supportAdminRouter = Router();
export const supportBridgeRouter = Router();

let deliverabilityCache: { domain: string; expiresAt: number; value: unknown } | null = null;

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
    where: status ? { status } : { status: { not: "CLOSED" } },
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
  const [mailboxes, open, escalated, pendingReview, learnedReplies, queuedReplies, sentReplies, failedReplies, verifiedSentCopies] = await Promise.all([
    prisma.supportMailbox.findMany({ orderBy: { updatedAt: "desc" } }),
    prisma.supportConversation.count({ where: { status: "OPEN" } }),
    prisma.supportConversation.count({ where: { status: "ESCALATED" } }),
    prisma.supportDraft.count({ where: { status: "PENDING_REVIEW" } }),
    prisma.supportVoiceExample.count({ where: { qualityStatus: { in: ["LEARNED", "APPROVED"] } } }),
    prisma.supportDraft.count({ where: { status: { in: ["QUEUED_TO_SEND", "SENDING"] } } }),
    prisma.supportDraft.count({ where: { status: "SENT" } }),
    prisma.supportDraft.count({ where: { status: "FAILED" } }),
    prisma.supportEvidenceEvent.count({ where: { kind: "OUTBOUND_DELIVERY_VERIFIED" } }),
  ]);
  res.setHeader("Cache-Control", "no-store");
  return res.json({ ok: true, mailboxes, counts: { open, escalated, pendingReview, learnedReplies, queuedReplies, sentReplies, failedReplies, verifiedSentCopies } });
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
    where: status ? { status } : { status: { not: "CLOSED" } },
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
