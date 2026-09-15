
-- CreateEnum
CREATE TYPE "CompanyCustomFieldTarget" AS ENUM ('CLIENT', 'DOCUMENT');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "customFields" JSONB;

-- CreateTable
CREATE TABLE "CompanyCustomField" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "target" "CompanyCustomFieldTarget" NOT NULL,
    "documentTypeId" TEXT,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "options" JSONB,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyCustomField_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyCustomField_companyId_idx" ON "CompanyCustomField"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyCustomField_companyId_target_documentTypeId_key_key" ON "CompanyCustomField"("companyId", "target", "documentTypeId", "key");

-- AddForeignKey
ALTER TABLE "CompanyCustomField" ADD CONSTRAINT "CompanyCustomField_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

