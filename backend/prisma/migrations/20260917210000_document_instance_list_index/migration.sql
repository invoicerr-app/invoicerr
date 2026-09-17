-- CreateIndex
CREATE INDEX "DocumentInstance_companyId_typeId_updatedAt_idx" ON "DocumentInstance"("companyId", "typeId", "updatedAt");
