-- CreateTable
CREATE TABLE "ComplianceReport" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "companyId" TEXT,
    "invoiceRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "submittedRef" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComplianceReport_kind_periodKey_companyId_idx" ON "ComplianceReport"("kind", "periodKey", "companyId");

-- CreateIndex
CREATE INDEX "ComplianceReport_companyId_status_idx" ON "ComplianceReport"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceReport_kind_periodKey_companyId_invoiceRef_key" ON "ComplianceReport"("kind", "periodKey", "companyId", "invoiceRef");
