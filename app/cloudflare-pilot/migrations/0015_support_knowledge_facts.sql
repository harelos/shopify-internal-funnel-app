CREATE TABLE "SupportKnowledgeFact" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "factText" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "position" INTEGER NOT NULL DEFAULT 0,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "updatedBy" TEXT NOT NULL DEFAULT 'SYSTEM_SEED',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "SupportKnowledgeFact_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SupportKnowledgeFact_shopId_key_key" ON "SupportKnowledgeFact"("shopId", "key");
CREATE INDEX "SupportKnowledgeFact_shopId_enabled_position_idx" ON "SupportKnowledgeFact"("shopId", "enabled", "position");

UPDATE "SupportDraft"
SET "replyText" = 'היי,

תודה על השאלה. חשוב לנו לתת לך מידע מדויק ומסודר.

אני בודקת כעת את רשימת הרכיבים ואת פרטי האישור הרלוונטיים למוצר, ואחזור אלייך עם המידע המלא לאחר בדיקה.

צוות Tiger Brands Global'
WHERE "status" = 'ESCALATED'
  AND length(trim("replyText")) = 0
  AND "conversationId" IN (SELECT "id" FROM "SupportConversation" WHERE "topic" = 'PRODUCT_INFORMATION');

UPDATE "SupportDraft"
SET "replyText" = 'היי,

תודה שכתבת לנו. קיבלנו את הפנייה ואנחנו בודקים את הפרטים כדי לתת לך מענה מדויק.

נחזור אלייך לאחר בדיקה.

צוות Tiger Brands Global'
WHERE "status" = 'ESCALATED' AND length(trim("replyText")) = 0;
