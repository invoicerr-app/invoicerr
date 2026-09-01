-- CreateTable
CREATE TABLE "DocumentDownloadToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "DocumentDownloadToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentDownloadToken_tokenHash_key" ON "DocumentDownloadToken"("tokenHash");

-- CreateIndex
CREATE INDEX "DocumentDownloadToken_documentId_idx" ON "DocumentDownloadToken"("documentId");

-- AddForeignKey
ALTER TABLE "DocumentDownloadToken" ADD CONSTRAINT "DocumentDownloadToken_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DocumentInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentDownloadToken" ADD CONSTRAINT "DocumentDownloadToken_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
