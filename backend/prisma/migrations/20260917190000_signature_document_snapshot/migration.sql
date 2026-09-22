-- Freezes the PDF a public signer reviewed, so the public "GET .../document" endpoint can always
-- serve back the SAME bytes instead of a fresh (and, with an active signing certificate, non-byte-
-- stable) render. See schema.prisma's own comment on Signature.documentPdfUri/documentPdfHash.
-- AlterTable
ALTER TABLE "Signature" ADD COLUMN     "documentPdfHash" TEXT,
ADD COLUMN     "documentPdfUri" TEXT;
