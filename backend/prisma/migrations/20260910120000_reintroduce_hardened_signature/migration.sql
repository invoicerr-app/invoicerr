-- Root TODO item 13 REDONE — reintroduces the electronic-signature model (see schema.prisma's own
-- header on the `Signature` model for the full "why", including the GHSA-vhjw-gwc5-pjfp advisory
-- this hardens against) and the DOCUMENT_SIGNED webhook event it emits on a successful sign.
--
-- Combines an `ALTER TYPE ... ADD VALUE` with a `CREATE TABLE` in one file — the same combination
-- 20260628121523_add_company_channel_config already applied successfully in this history, so this is
-- not a new pattern. The single-value-add discipline 20260903180000_add_document_cancelled_webhook_event
-- documents (plain ADD VALUE, no CREATE TYPE/swap dance) still applies: nothing here REMOVES a value.
ALTER TYPE "WebhookEvent" ADD VALUE 'DOCUMENT_SIGNED';

-- CreateTable
CREATE TABLE "Signature" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "otpCodeHash" TEXT,
    "otpExpiresAt" TIMESTAMP(3),
    "otpFailedAttempts" INTEGER NOT NULL DEFAULT 0,
    "otpResendCount" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Signature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Signature_tokenHash_key" ON "Signature"("tokenHash");

-- CreateIndex
CREATE INDEX "Signature_documentId_idx" ON "Signature"("documentId");

-- CreateIndex
CREATE INDEX "Signature_companyId_idx" ON "Signature"("companyId");

-- AddForeignKey
ALTER TABLE "Signature" ADD CONSTRAINT "Signature_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DocumentInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signature" ADD CONSTRAINT "Signature_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
