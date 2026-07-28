-- CreateEnum
CREATE TYPE "ChannelEnvironment" AS ENUM ('TEST', 'PROD');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ComplianceDocumentKind" ADD VALUE 'PROFORMA';
ALTER TYPE "ComplianceDocumentKind" ADD VALUE 'DEPOSIT';
ALTER TYPE "ComplianceDocumentKind" ADD VALUE 'FINAL';

-- DropForeignKey
ALTER TABLE "NumberSeries" DROP CONSTRAINT "NumberSeries_companyId_fkey";

-- CreateTable
CREATE TABLE "CompanyChannelConfig" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "environment" "ChannelEnvironment" NOT NULL DEFAULT 'TEST',
    "config" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyChannelConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyChannelConfig_companyId_idx" ON "CompanyChannelConfig"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyChannelConfig_companyId_providerId_environment_key" ON "CompanyChannelConfig"("companyId", "providerId", "environment");

-- AddForeignKey
ALTER TABLE "NumberSeries" ADD CONSTRAINT "NumberSeries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyChannelConfig" ADD CONSTRAINT "CompanyChannelConfig_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "ComplianceCallbackRegistration_channel_correlationKey_status_id" RENAME TO "ComplianceCallbackRegistration_channel_correlationKey_statu_idx";
