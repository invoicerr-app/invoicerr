-- Issue #477: bind an e-signature request to the exact delivered version the client read.
-- All four columns are nullable: rows created before this binding existed keep NULL and are
-- never signable again (nothing proves which version their signer read). No backfill, on purpose.

-- AlterTable
ALTER TABLE "Signature" ADD COLUMN     "deliveryArchiveId" TEXT,
ADD COLUMN     "deliveryContentHash" TEXT,
ADD COLUMN     "documentData" JSONB,
ADD COLUMN     "documentDataHash" TEXT;

-- AddForeignKey
ALTER TABLE "Signature" ADD CONSTRAINT "Signature_deliveryArchiveId_fkey" FOREIGN KEY ("deliveryArchiveId") REFERENCES "DocumentArchive"("id") ON DELETE SET NULL ON UPDATE CASCADE;
