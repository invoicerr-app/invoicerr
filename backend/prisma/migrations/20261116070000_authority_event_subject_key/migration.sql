-- AlterTable
ALTER TABLE "DocumentAuthorityEvent" ADD COLUMN "subjectKey" TEXT NOT NULL DEFAULT '';

-- DropIndex
DROP INDEX "DocumentAuthorityEvent_documentId_providerId_statusCode_key";

-- CreateIndex
CREATE UNIQUE INDEX "DocumentAuthorityEvent_documentId_providerId_statusCode_sub_key" ON "DocumentAuthorityEvent"("documentId", "providerId", "statusCode", "subjectKey");
