/*
  Multi-tenant migration: Add companyId to Client table

  Strategy for existing data:
  1. Add column as nullable
  2. Update existing clients to use the first company
  3. Make column required
  4. Add foreign key constraint
*/

-- DropIndex (contactEmail no longer unique across all companies)
DROP INDEX IF EXISTS "Client_contactEmail_key";

-- AlterTable: Add companyId as nullable first
ALTER TABLE "Client" ADD COLUMN "companyId" TEXT;

-- Update existing clients to use the first company
UPDATE "Client" SET "companyId" = (SELECT id FROM "Company" LIMIT 1) WHERE "companyId" IS NULL;

-- Make the column required
ALTER TABLE "Client" ALTER COLUMN "companyId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Client_companyId_idx" ON "Client"("companyId");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add unique constraint for contactEmail per company (optional: allow same email in different companies)
CREATE UNIQUE INDEX "Client_companyId_contactEmail_key" ON "Client"("companyId", "contactEmail") WHERE "contactEmail" IS NOT NULL;
