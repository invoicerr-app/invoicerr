-- CreateEnum
CREATE TYPE "BankStatementFormat" AS ENUM ('CSV', 'OFX');

-- CreateEnum
CREATE TYPE "BankStatementLineStatus" AS ENUM ('UNMATCHED', 'RECONCILED');

-- CreateTable
CREATE TABLE "BankStatement" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "format" "BankStatementFormat" NOT NULL,
    "currency" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatementLine" (
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "lineIndex" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "reference" TEXT,
    "raw" JSONB NOT NULL,
    "status" "BankStatementLineStatus" NOT NULL DEFAULT 'UNMATCHED',
    "reconciledDocumentId" TEXT,
    "reconciledPaymentId" TEXT,
    "reconciledAt" TIMESTAMP(3),

    CONSTRAINT "BankStatementLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankStatement_companyId_idx" ON "BankStatement"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "BankStatementLine_reconciledPaymentId_key" ON "BankStatementLine"("reconciledPaymentId");

-- CreateIndex
CREATE INDEX "BankStatementLine_companyId_status_idx" ON "BankStatementLine"("companyId", "status");

-- CreateIndex
CREATE INDEX "BankStatementLine_statementId_idx" ON "BankStatementLine"("statementId");

-- AddForeignKey
ALTER TABLE "BankStatement" ADD CONSTRAINT "BankStatement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "BankStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_reconciledDocumentId_fkey" FOREIGN KEY ("reconciledDocumentId") REFERENCES "DocumentInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_reconciledPaymentId_fkey" FOREIGN KEY ("reconciledPaymentId") REFERENCES "DocumentPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
