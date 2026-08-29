-- CreateTable
CREATE TABLE "DocumentInstance" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentInstance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentInstance_companyId_typeId_idx" ON "DocumentInstance"("companyId", "typeId");

-- AddForeignKey
ALTER TABLE "DocumentInstance" ADD CONSTRAINT "DocumentInstance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
