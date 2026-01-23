/*
  Warnings:

  - You are about to drop the column `VAT` on the `Company` table. All the data in the column will be lost.
  - You are about to drop the column `legalId` on the `Company` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Company" DROP COLUMN "VAT",
DROP COLUMN "legalId",
ADD COLUMN     "identifiers" JSONB NOT NULL DEFAULT '{}';
