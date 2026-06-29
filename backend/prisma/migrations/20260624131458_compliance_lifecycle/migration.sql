-- Additive compliance lifecycle persistence (COMPLIANCE_ARCHITECTURE.md §13 / TODO_PRISMA.md §4).
-- No existing tables/columns are dropped or renamed.

-- CreateEnum
CREATE TYPE "ComplianceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PENDING_CLEARANCE', 'CLEARED', 'REJECTED', 'CONTINGENCY', 'DELIVERED', 'AWAITING_RESPONSE', 'ACCEPTED', 'REFUSED', 'DISPUTED', 'REPORTED', 'CANCELLED', 'CORRECTED', 'LEGACY');

-- CreateEnum
CREATE TYPE "ComplianceDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "ComplianceDocumentKind" AS ENUM ('INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'CORRECTIVE_INVOICE', 'PREPAYMENT', 'SELF_BILLED', 'EXPORT_INVOICE', 'CASH_RECEIPT', 'WITHHOLDING_RECEIPT', 'PAYMENT_RECEIPT');

-- CreateEnum
CREATE TYPE "ScheduledJobKind" AS ENUM ('POLL', 'TIMER');

-- CreateEnum
CREATE TYPE "ScheduledJobStatus" AS ENUM ('PENDING', 'ARMED', 'DONE', 'FIRED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CallbackRegStatus" AS ENUM ('WAITING', 'RESOLVED', 'CANCELLED');

-- CreateTable
CREATE TABLE "ComplianceDocument" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT,
    "kind" "ComplianceDocumentKind" NOT NULL DEFAULT 'INVOICE',
    "direction" "ComplianceDirection" NOT NULL DEFAULT 'OUTBOUND',
    "status" "ComplianceStatus" NOT NULL DEFAULT 'DRAFT',
    "ctx" JSONB NOT NULL,
    "plan" JSONB,
    "lifecycleGraph" JSONB,
    "profileVersion" TEXT,
    "number" TEXT,
    "immutableHash" TEXT,
    "previousHash" TEXT,
    "correctsId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateForeignKey
ALTER TABLE "ComplianceDocument" ADD CONSTRAINT "ComplianceDocument_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ComplianceEvent" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT,
    "detail" TEXT,
    "payload" JSONB,

    CONSTRAINT "ComplianceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateForeignKey
ALTER TABLE "ComplianceEvent" ADD CONSTRAINT "ComplianceEvent_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ComplianceDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ComplianceAuthorityId" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "scheme" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceAuthorityId_pkey" PRIMARY KEY ("id")
);

-- CreateForeignKey
ALTER TABLE "ComplianceAuthorityId" ADD CONSTRAINT "ComplianceAuthorityId_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ComplianceDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ScheduledJob" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "kind" "ScheduledJobKind" NOT NULL,
    "status" "ScheduledJobStatus" NOT NULL DEFAULT 'PENDING',
    "awaiting" TEXT NOT NULL,
    "providerId" TEXT,
    "channel" TEXT,
    "ref" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextRunAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "policy" JSONB,
    "onElapse" TEXT,
    "fireAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduledJob_pkey" PRIMARY KEY ("id")
);

-- CreateForeignKey
ALTER TABLE "ScheduledJob" ADD CONSTRAINT "ScheduledJob_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ComplianceDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ComplianceCallbackRegistration" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "correlationKey" TEXT NOT NULL,
    "awaiting" TEXT NOT NULL,
    "status" "CallbackRegStatus" NOT NULL DEFAULT 'WAITING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceCallbackRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateForeignKey
ALTER TABLE "ComplianceCallbackRegistration" ADD CONSTRAINT "ComplianceCallbackRegistration_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ComplianceDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ComplianceInboundMessage" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "correlationKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rawRef" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceInboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComplianceDocument_status_idx" ON "ComplianceDocument"("status");

-- CreateIndex
CREATE INDEX "ComplianceDocument_invoiceId_idx" ON "ComplianceDocument"("invoiceId");

-- CreateIndex
CREATE INDEX "ComplianceEvent_documentId_idx" ON "ComplianceEvent"("documentId");

-- CreateIndex
CREATE INDEX "ComplianceAuthorityId_documentId_idx" ON "ComplianceAuthorityId"("documentId");

-- CreateIndex
CREATE INDEX "ScheduledJob_kind_status_nextRunAt_idx" ON "ScheduledJob"("kind", "status", "nextRunAt");

-- CreateIndex
CREATE INDEX "ScheduledJob_kind_status_fireAt_idx" ON "ScheduledJob"("kind", "status", "fireAt");

-- CreateIndex
CREATE INDEX "ScheduledJob_documentId_idx" ON "ScheduledJob"("documentId");

-- CreateIndex
CREATE INDEX "ComplianceCallbackRegistration_channel_correlationKey_status_idx" ON "ComplianceCallbackRegistration"("channel", "correlationKey", "status");

-- CreateIndex
CREATE INDEX "ComplianceCallbackRegistration_documentId_idx" ON "ComplianceCallbackRegistration"("documentId");

-- CreateIndex
CREATE INDEX "ComplianceInboundMessage_channel_correlationKey_idx" ON "ComplianceInboundMessage"("channel", "correlationKey");