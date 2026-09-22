-- Adds `Log.companyId` — deliberately no foreign key (see schema.prisma's own comment on this column):
-- a log write must never fail because of what it is ABOUT, and at least two write sites carry a
-- companyId that may not resolve to a current `Company` row as their NORMAL, documented behavior.
-- AlterTable
ALTER TABLE "Log" ADD COLUMN     "companyId" TEXT;

-- CreateIndex
CREATE INDEX "Log_companyId_timestamp_idx" ON "Log"("companyId", "timestamp");
