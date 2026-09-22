-- AlterTable
ALTER TABLE "DocumentInstance" ADD COLUMN     "conformityResolvedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "document_instance_conformity_sweep_idx" ON "DocumentInstance"("status", "channelProviderId", "conformityResolvedAt");
