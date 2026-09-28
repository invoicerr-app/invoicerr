-- AlterTable
ALTER TABLE "DocumentInstance" ADD COLUMN     "vatNationalCurrency" TEXT,
ADD COLUMN     "vatNationalCurrencyRate" DECIMAL(65,30),
ADD COLUMN     "vatNationalCurrencyRateAsOf" TIMESTAMP(3),
ADD COLUMN     "vatNationalCurrencyRateSource" TEXT,
ADD COLUMN     "vatNationalCurrencyTaxableMinor" INTEGER,
ADD COLUMN     "vatNationalCurrencyVatMinor" INTEGER;
