-- AlterTable: new scopes column, defaulted to empty array so this applies
-- cleanly to existing rows. Existing keys predate the scopes concept and
-- were minted under the old all-or-nothing company-ADMIN model; they are
-- backfilled to full access below so no live integration silently loses
-- capability on deploy. New keys created after this migration default to
-- an empty scope set (see api-keys.service.ts) — the actual security
-- improvement is that granting scope becomes a deliberate choice going
-- forward, not a retroactive revocation now.
ALTER TABLE "api_key" ADD COLUMN     "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Backfill: grant every existing API key every scope that exists as of
-- this migration, since they were all created before the scopes concept
-- existed and were implicitly full-access. Keys created after this
-- migration start from an empty scope set instead (app-level default in
-- api-keys.service.ts#create), so this backfill is a one-time compatibility
-- step, not the ongoing default.
UPDATE "api_key" SET "scopes" = ARRAY[
  'quotes:write', 'invoices:write', 'clients:write', 'articles:write', 'articles:read'
]::TEXT[] WHERE "scopes" = ARRAY[]::TEXT[];

-- CreateEnum
CREATE TYPE "PdfDocumentType" AS ENUM ('QUOTE', 'INVOICE');

-- CreateTable
CREATE TABLE "PdfDownloadToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "documentType" "PdfDocumentType" NOT NULL,
    "documentId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PdfDownloadToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PdfDownloadToken_tokenHash_key" ON "PdfDownloadToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PdfDownloadToken_documentId_idx" ON "PdfDownloadToken"("documentId");

-- AddForeignKey
ALTER TABLE "PdfDownloadToken" ADD CONSTRAINT "PdfDownloadToken_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
