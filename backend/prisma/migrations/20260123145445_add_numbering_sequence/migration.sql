-- CreateTable
CREATE TABLE "numbering_sequence" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "series" TEXT,
    "documentType" TEXT NOT NULL DEFAULT 'invoice',
    "lastSequence" INTEGER NOT NULL DEFAULT 0,
    "lastHash" TEXT,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "numbering_sequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "numbering_sequence_companyId_idx" ON "numbering_sequence"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "numbering_sequence_companyId_series_documentType_key" ON "numbering_sequence"("companyId", "series", "documentType");
