-- AlterTable
ALTER TABLE "DocumentInstance" ADD COLUMN     "transportRef" TEXT;

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
ALTER TABLE "CompanyChannelConfig" ADD CONSTRAINT "CompanyChannelConfig_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
