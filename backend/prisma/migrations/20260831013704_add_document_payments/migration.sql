-- CreateTable
CREATE TABLE "DocumentPayment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "method" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentPayment_companyId_documentId_idx" ON "DocumentPayment"("companyId", "documentId");

-- AddForeignKey
ALTER TABLE "DocumentPayment" ADD CONSTRAINT "DocumentPayment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentPayment" ADD CONSTRAINT "DocumentPayment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DocumentInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
