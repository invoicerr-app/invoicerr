-- Issue #490: record, on every DELIVERY archive, a hash of the document data its PDF was rendered
-- from, so the PDF download can tell whether the archived copy still matches the document as it
-- stands. Nullable, no backfill: nothing proves which data an existing archive was rendered from.

-- AlterTable
ALTER TABLE "DocumentArchive" ADD COLUMN     "documentDataHash" TEXT;

-- AlterTable
ALTER TABLE "PendingDocumentArchive" ADD COLUMN     "documentDataHash" TEXT;
