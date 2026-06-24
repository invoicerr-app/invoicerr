-- AlterEnum
ALTER TYPE "InvoiceStatus" ADD VALUE 'ARCHIVED';

-- AlterTable
ALTER TABLE "Invoice" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
