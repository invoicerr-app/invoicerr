-- CreateTable
CREATE TABLE "DocumentSchedule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "sourceDocumentId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "cadence" TEXT NOT NULL,
    "anchorDay" INTEGER,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "lastError" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "params" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentSchedule_companyId_typeId_idx" ON "DocumentSchedule"("companyId", "typeId");

-- CreateIndex
CREATE INDEX "DocumentSchedule_enabled_nextRunAt_idx" ON "DocumentSchedule"("enabled", "nextRunAt");

-- AddForeignKey
ALTER TABLE "DocumentSchedule" ADD CONSTRAINT "DocumentSchedule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
