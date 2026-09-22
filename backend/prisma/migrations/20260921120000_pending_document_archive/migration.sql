-- CreateTable
CREATE TABLE "PendingDocumentArchive" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "artifacts" JSONB NOT NULL,
    "firstFailedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT NOT NULL,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL,
    "escalatedAt" TIMESTAMP(3),

    CONSTRAINT "PendingDocumentArchive_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PendingDocumentArchive_documentId_key" ON "PendingDocumentArchive"("documentId");

-- CreateIndex
CREATE INDEX "PendingDocumentArchive_nextAttemptAt_idx" ON "PendingDocumentArchive"("nextAttemptAt");

-- AddForeignKey
ALTER TABLE "PendingDocumentArchive" ADD CONSTRAINT "PendingDocumentArchive_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DocumentInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
