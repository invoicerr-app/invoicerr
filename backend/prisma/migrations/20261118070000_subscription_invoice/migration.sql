-- CreateTable
CREATE TABLE "subscription_invoice" (
    "id" TEXT NOT NULL,
    "stripeInvoiceId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "companyId" TEXT,
    "currency" TEXT NOT NULL,
    "amountPaid" INTEGER NOT NULL,
    "lines" JSONB NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "issuerCompanyId" TEXT,
    "clientId" TEXT,
    "documentId" TEXT,
    "issuedAt" TIMESTAMP(3),
    "paymentRecordedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_invoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_invoice_stripeInvoiceId_key" ON "subscription_invoice"("stripeInvoiceId");

-- CreateIndex
CREATE INDEX "subscription_invoice_paymentRecordedAt_idx" ON "subscription_invoice"("paymentRecordedAt");

-- CreateIndex
CREATE INDEX "subscription_invoice_companyId_idx" ON "subscription_invoice"("companyId");
