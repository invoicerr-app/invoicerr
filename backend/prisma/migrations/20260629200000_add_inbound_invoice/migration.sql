-- CreateEnum
CREATE TYPE "InboundInvoiceStatus" AS ENUM ('RECEIVED', 'PARSED', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "InboundInvoice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "providerId" TEXT,
    "externalId" TEXT NOT NULL,
    "senderId" TEXT,
    "syntax" TEXT,
    "rawPayload" TEXT NOT NULL,
    "invoiceNumber" TEXT,
    "issueDate" TEXT,
    "sellerName" TEXT,
    "sellerTaxId" TEXT,
    "buyerTaxId" TEXT,
    "currency" TEXT,
    "totalNet" DOUBLE PRECISION,
    "totalTax" DOUBLE PRECISION,
    "totalGross" DOUBLE PRECISION,
    "status" "InboundInvoiceStatus" NOT NULL DEFAULT 'RECEIVED',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboundInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InboundInvoice_channel_externalId_key" ON "InboundInvoice"("channel", "externalId");

-- CreateIndex
CREATE INDEX "InboundInvoice_companyId_receivedAt_idx" ON "InboundInvoice"("companyId", "receivedAt");

-- CreateIndex
CREATE INDEX "InboundInvoice_status_idx" ON "InboundInvoice"("status");
