-- AlterTable
ALTER TABLE "DocumentInstance" ADD COLUMN     "channelProviderId" TEXT;

-- CreateTable
CREATE TABLE "DocumentAuthorityEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "statusCode" TEXT NOT NULL,
    "statusText" TEXT,
    "reason" TEXT,
    "rawPayload" JSONB,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentAuthorityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentAuthorityEvent_companyId_documentId_idx" ON "DocumentAuthorityEvent"("companyId", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentAuthorityEvent_documentId_providerId_statusCode_key" ON "DocumentAuthorityEvent"("documentId", "providerId", "statusCode");

-- AddForeignKey
ALTER TABLE "DocumentAuthorityEvent" ADD CONSTRAINT "DocumentAuthorityEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAuthorityEvent" ADD CONSTRAINT "DocumentAuthorityEvent_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DocumentInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
