-- AlterTable
ALTER TABLE "DocumentInstance" ADD COLUMN     "lastArchiveError" TEXT;

-- CreateTable
CREATE TABLE "DocumentArchive" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "uri" TEXT NOT NULL,
    "artifacts" JSONB NOT NULL,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retentionUntil" TIMESTAMP(3),
    "retentionBasis" TEXT,

    CONSTRAINT "DocumentArchive_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentArchive_companyId_documentId_idx" ON "DocumentArchive"("companyId", "documentId");

-- AddForeignKey
ALTER TABLE "DocumentArchive" ADD CONSTRAINT "DocumentArchive_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentArchive" ADD CONSTRAINT "DocumentArchive_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DocumentInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
