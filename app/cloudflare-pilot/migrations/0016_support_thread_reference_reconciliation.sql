-- Attach manually sent replies to the customer thread they reference instead
-- of leaving a second outbound-only row in the owner inbox. The original
-- evidence ledger stays on the closed child row so its hash chain is retained.

INSERT OR IGNORE INTO "SupportVoiceExample"
  ("id", "shopId", "inboundExternalId", "outboundExternalId", "topic", "customerMessage", "ownerReply", "qualityStatus", "createdAt")
SELECT
  'voice_reconciled_' || lower(hex(randomblob(16))),
  parent."shopId",
  inbound."externalMessageId",
  outbound."externalMessageId",
  parent."topic",
  inbound."textBody",
  outbound."textBody",
  'PENDING_REVIEW',
  datetime('now')
FROM "SupportConversation" child
JOIN "SupportMessage" inbound
  ON inbound."externalMessageId" = child."externalThreadKey"
 AND inbound."direction" = 'INBOUND'
JOIN "SupportConversation" parent
  ON parent."id" = inbound."conversationId"
JOIN "SupportMessage" outbound
  ON outbound."conversationId" = child."id"
 AND outbound."direction" = 'OUTBOUND'
WHERE child."id" <> parent."id"
  AND NOT EXISTS (SELECT 1 FROM "SupportMessage" ci WHERE ci."conversationId" = child."id" AND ci."direction" = 'INBOUND')
  AND NOT EXISTS (SELECT 1 FROM "SupportDraft" cd WHERE cd."conversationId" = child."id");

UPDATE "SupportConversation"
SET
  "status" = 'WAITING_CUSTOMER',
  "lastAgentMessageAt" = (
    SELECT MAX(outbound."sentAt")
    FROM "SupportConversation" child
    JOIN "SupportMessage" inbound
      ON inbound."externalMessageId" = child."externalThreadKey"
     AND inbound."direction" = 'INBOUND'
    JOIN "SupportMessage" outbound
      ON outbound."conversationId" = child."id"
     AND outbound."direction" = 'OUTBOUND'
    WHERE inbound."conversationId" = "SupportConversation"."id"
      AND child."id" <> "SupportConversation"."id"
      AND NOT EXISTS (SELECT 1 FROM "SupportMessage" ci WHERE ci."conversationId" = child."id" AND ci."direction" = 'INBOUND')
      AND NOT EXISTS (SELECT 1 FROM "SupportDraft" cd WHERE cd."conversationId" = child."id")
  ),
  "nextActionAt" = NULL,
  "updatedAt" = datetime('now')
WHERE "id" IN (
  SELECT inbound."conversationId"
  FROM "SupportConversation" child
  JOIN "SupportMessage" inbound
    ON inbound."externalMessageId" = child."externalThreadKey"
   AND inbound."direction" = 'INBOUND'
  WHERE child."id" <> inbound."conversationId"
    AND NOT EXISTS (SELECT 1 FROM "SupportMessage" ci WHERE ci."conversationId" = child."id" AND ci."direction" = 'INBOUND')
    AND NOT EXISTS (SELECT 1 FROM "SupportDraft" cd WHERE cd."conversationId" = child."id")
);

UPDATE "SupportMessage"
SET "conversationId" = (
  SELECT inbound."conversationId"
  FROM "SupportConversation" child
  JOIN "SupportMessage" inbound
    ON inbound."externalMessageId" = child."externalThreadKey"
   AND inbound."direction" = 'INBOUND'
  WHERE child."id" = "SupportMessage"."conversationId"
    AND child."id" <> inbound."conversationId"
  LIMIT 1
)
WHERE "conversationId" IN (
  SELECT child."id"
  FROM "SupportConversation" child
  JOIN "SupportMessage" inbound
    ON inbound."externalMessageId" = child."externalThreadKey"
   AND inbound."direction" = 'INBOUND'
  WHERE child."id" <> inbound."conversationId"
    AND NOT EXISTS (SELECT 1 FROM "SupportMessage" ci WHERE ci."conversationId" = child."id" AND ci."direction" = 'INBOUND')
    AND NOT EXISTS (SELECT 1 FROM "SupportDraft" cd WHERE cd."conversationId" = child."id")
);

UPDATE "SupportConversation"
SET
  "status" = 'CLOSED',
  "audienceType" = 'NON_CUSTOMER',
  "triageStatus" = 'IGNORED',
  "triageReason" = 'OUTBOUND_REPLY_RECONCILED_TO_REFERENCED_THREAD',
  "nextActionAt" = NULL,
  "updatedAt" = datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM "SupportMessage" m WHERE m."conversationId" = "SupportConversation"."id")
  AND NOT EXISTS (SELECT 1 FROM "SupportDraft" d WHERE d."conversationId" = "SupportConversation"."id")
  AND EXISTS (
    SELECT 1
    FROM "SupportMessage" inbound
    WHERE inbound."externalMessageId" = "SupportConversation"."externalThreadKey"
      AND inbound."direction" = 'INBOUND'
      AND inbound."conversationId" <> "SupportConversation"."id"
  );
