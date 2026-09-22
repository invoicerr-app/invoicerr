-- CreateTable
CREATE TABLE "VatRate" (
    "id" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "confidence" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceCheckedAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VatRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VatRate_countryCode_idx" ON "VatRate"("countryCode");

-- CreateIndex
CREATE UNIQUE INDEX "VatRate_countryCode_sourceId_validFrom_key" ON "VatRate"("countryCode", "sourceId", "validFrom");
