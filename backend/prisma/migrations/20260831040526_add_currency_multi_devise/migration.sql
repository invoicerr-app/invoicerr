-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "referenceCurrency" TEXT;

-- CreateTable
CREATE TABLE "CurrencyRate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "rate" DECIMAL(65,30) NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CurrencyRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CurrencyRate_companyId_from_to_asOf_idx" ON "CurrencyRate"("companyId", "from", "to", "asOf");

-- AddForeignKey
ALTER TABLE "CurrencyRate" ADD CONSTRAINT "CurrencyRate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
