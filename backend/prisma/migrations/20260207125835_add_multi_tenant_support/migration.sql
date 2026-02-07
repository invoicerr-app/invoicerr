/*
  Warnings:

  - Added the required column `companyId` to the `Client` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "companyId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "Client_companyId_idx" ON "Client"("companyId");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
