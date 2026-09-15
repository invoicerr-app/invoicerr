-- CreateEnum
CREATE TYPE "PaymentCheckoutSessionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "PaymentCheckoutSession" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "providerSessionId" TEXT NOT NULL,
    "status" "PaymentCheckoutSessionStatus" NOT NULL DEFAULT 'PENDING',
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "checkoutUrl" TEXT NOT NULL,
    "paymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentCheckoutSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentCheckoutSession_paymentId_key" ON "PaymentCheckoutSession"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentCheckoutSession_providerId_providerSessionId_key" ON "PaymentCheckoutSession"("providerId", "providerSessionId");

-- CreateIndex
CREATE INDEX "PaymentCheckoutSession_companyId_documentId_idx" ON "PaymentCheckoutSession"("companyId", "documentId");

-- AddForeignKey
ALTER TABLE "PaymentCheckoutSession" ADD CONSTRAINT "PaymentCheckoutSession_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentCheckoutSession" ADD CONSTRAINT "PaymentCheckoutSession_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DocumentInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentCheckoutSession" ADD CONSTRAINT "PaymentCheckoutSession_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "DocumentPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
