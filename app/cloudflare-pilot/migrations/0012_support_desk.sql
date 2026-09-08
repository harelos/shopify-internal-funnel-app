CREATE TABLE "SupportMailbox" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'NAMECHEAP_PRIVATE_EMAIL',
  "connectionStatus" TEXT NOT NULL DEFAULT 'CONFIGURED',
  "automationMode" TEXT NOT NULL DEFAULT 'DRAFT_ONLY',
  "replyDelayMinutes" INTEGER NOT NULL DEFAULT 5,
  "lastSyncAt" DATETIME,
  "lastAgentRunAt" DATETIME,
  "nextAgentRunAt" DATETIME,
  "lastAgentResult" TEXT,
  "lastScanCount" INTEGER NOT NULL DEFAULT 0,
  "ignoredMessageCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "SupportMailbox_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "SupportCustomer" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "displayName" TEXT,
  "shopifyCustomerGid" TEXT,
  "lifetimeOrders" INTEGER,
  "riskLevel" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "riskReasonsJson" TEXT NOT NULL DEFAULT '[]',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "SupportCustomer_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "SupportConversation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "mailboxId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "externalThreadKey" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "priority" TEXT NOT NULL DEFAULT 'NORMAL',
  "topic" TEXT NOT NULL DEFAULT 'OTHER',
  "audienceType" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "triageStatus" TEXT NOT NULL DEFAULT 'ACCEPTED',
  "triageReason" TEXT,
  "language" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "confidence" REAL NOT NULL DEFAULT 0,
  "riskLevel" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "assignedTo" TEXT,
  "escalationReason" TEXT,
  "summary" TEXT,
  "shopifyOrderGid" TEXT,
  "shopifyOrderName" TEXT,
  "nextActionAt" DATETIME,
  "lastCustomerMessageAt" DATETIME,
  "lastAgentMessageAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "SupportConversation_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SupportConversation_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "SupportMailbox" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SupportConversation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "SupportCustomer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "SupportMessage" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  "externalMessageId" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "fromAddress" TEXT NOT NULL,
  "toAddressesJson" TEXT NOT NULL DEFAULT '[]',
  "subject" TEXT NOT NULL,
  "textBody" TEXT NOT NULL,
  "sentAt" DATETIME NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'IMAP',
  "deliveryStatus" TEXT NOT NULL DEFAULT 'RECEIVED',
  "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
  "triageClass" TEXT NOT NULL DEFAULT 'REVIEW',
  "triageScore" REAL NOT NULL DEFAULT 0,
  "triageReasonsJson" TEXT NOT NULL DEFAULT '[]',
  "inReplyTo" TEXT,
  "referencesJson" TEXT NOT NULL DEFAULT '[]',
  "attachmentsJson" TEXT NOT NULL DEFAULT '[]',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SupportConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "SupportDraft" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  "decision" TEXT NOT NULL DEFAULT 'ESCALATE',
  "replyText" TEXT NOT NULL,
  "model" TEXT,
  "confidence" REAL NOT NULL DEFAULT 0,
  "reason" TEXT NOT NULL,
  "verifiedFactsJson" TEXT NOT NULL DEFAULT '{}',
  "policyFlagsJson" TEXT NOT NULL DEFAULT '[]',
  "sendAfter" DATETIME,
  "claimedAt" DATETIME,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastDeliveryError" TEXT,
  "sentAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "SupportDraft_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SupportConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "SupportEvidenceEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "previousHash" TEXT,
  "contentHash" TEXT NOT NULL,
  "payloadJson" TEXT NOT NULL,
  "occurredAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportEvidenceEvent_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SupportConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "SupportVoiceExample" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "inboundExternalId" TEXT NOT NULL,
  "outboundExternalId" TEXT NOT NULL,
  "topic" TEXT NOT NULL DEFAULT 'OTHER',
  "customerMessage" TEXT NOT NULL,
  "ownerReply" TEXT NOT NULL,
  "qualityStatus" TEXT NOT NULL DEFAULT 'LEARNED',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportVoiceExample_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SupportMailbox_shopId_address_key" ON "SupportMailbox"("shopId", "address");
CREATE INDEX "SupportMailbox_shopId_connectionStatus_idx" ON "SupportMailbox"("shopId", "connectionStatus");
CREATE UNIQUE INDEX "SupportCustomer_shopId_email_key" ON "SupportCustomer"("shopId", "email");
CREATE INDEX "SupportCustomer_shopId_riskLevel_idx" ON "SupportCustomer"("shopId", "riskLevel");
CREATE UNIQUE INDEX "SupportConversation_shopId_externalThreadKey_key" ON "SupportConversation"("shopId", "externalThreadKey");
CREATE INDEX "SupportConversation_shopId_status_updatedAt_idx" ON "SupportConversation"("shopId", "status", "updatedAt");
CREATE INDEX "SupportConversation_shopId_nextActionAt_idx" ON "SupportConversation"("shopId", "nextActionAt");
CREATE UNIQUE INDEX "SupportMessage_externalMessageId_key" ON "SupportMessage"("externalMessageId");
CREATE INDEX "SupportMessage_conversationId_sentAt_idx" ON "SupportMessage"("conversationId", "sentAt");
CREATE INDEX "SupportMessage_direction_sentAt_idx" ON "SupportMessage"("direction", "sentAt");
CREATE INDEX "SupportDraft_conversationId_status_createdAt_idx" ON "SupportDraft"("conversationId", "status", "createdAt");
CREATE INDEX "SupportDraft_status_sendAfter_idx" ON "SupportDraft"("status", "sendAfter");
CREATE INDEX "SupportEvidenceEvent_conversationId_occurredAt_idx" ON "SupportEvidenceEvent"("conversationId", "occurredAt");
CREATE INDEX "SupportEvidenceEvent_kind_occurredAt_idx" ON "SupportEvidenceEvent"("kind", "occurredAt");
CREATE UNIQUE INDEX "SupportVoiceExample_shopId_inboundExternalId_outboundExternalId_key" ON "SupportVoiceExample"("shopId", "inboundExternalId", "outboundExternalId");
CREATE INDEX "SupportVoiceExample_shopId_topic_qualityStatus_idx" ON "SupportVoiceExample"("shopId", "topic", "qualityStatus");
