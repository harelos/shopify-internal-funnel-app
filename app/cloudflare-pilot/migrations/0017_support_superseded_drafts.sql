-- A draft must never remain actionable after a newer reply already exists in
-- the mailbox Sent folder for the same reconciled customer conversation.

UPDATE "SupportDraft"
SET
  "status" = 'REJECTED',
  "sendAfter" = NULL,
  "claimedAt" = NULL,
  "lastDeliveryError" = 'Superseded by a later reply imported from the mailbox Sent folder.',
  "updatedAt" = datetime('now')
WHERE "sentAt" IS NULL
  AND "status" IN ('PENDING_REVIEW', 'ESCALATED', 'QUEUED_TO_SEND', 'SENDING')
  AND EXISTS (
    SELECT 1
    FROM "SupportMessage" outbound
    WHERE outbound."conversationId" = "SupportDraft"."conversationId"
      AND outbound."direction" = 'OUTBOUND'
      AND outbound."sentAt" >= "SupportDraft"."createdAt"
  );
