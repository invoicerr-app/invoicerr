-- AlterTable
ALTER TABLE "CompanyChannelConfig" ADD COLUMN     "pushToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CompanyChannelConfig_pushToken_key" ON "CompanyChannelConfig"("pushToken");
