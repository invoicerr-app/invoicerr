-- AlterTable
ALTER TABLE "QuoteItem" ADD COLUMN     "name" TEXT;
ALTER TABLE "InvoiceItem" ADD COLUMN     "name" TEXT;
ALTER TABLE "RecurringInvoiceItem" ADD COLUMN     "name" TEXT;

-- Backfill: use the existing description as the name for pre-existing rows
UPDATE "QuoteItem" SET "name" = substring("description" from 1 for 100) WHERE "name" IS NULL;
UPDATE "InvoiceItem" SET "name" = substring("description" from 1 for 100) WHERE "name" IS NULL;
UPDATE "RecurringInvoiceItem" SET "name" = substring("description" from 1 for 100) WHERE "name" IS NULL;

-- Make "name" required now that it is backfilled
ALTER TABLE "QuoteItem" ALTER COLUMN "name" SET NOT NULL;
ALTER TABLE "InvoiceItem" ALTER COLUMN "name" SET NOT NULL;
ALTER TABLE "RecurringInvoiceItem" ALTER COLUMN "name" SET NOT NULL;

-- Description becomes optional
ALTER TABLE "QuoteItem" ALTER COLUMN "description" DROP NOT NULL;
ALTER TABLE "InvoiceItem" ALTER COLUMN "description" DROP NOT NULL;
ALTER TABLE "RecurringInvoiceItem" ALTER COLUMN "description" DROP NOT NULL;

-- Clear description on pre-existing rows: it was only used as the item label
-- (now moved to "name"), so keep existing documents looking the same instead
-- of duplicating that text as a sub-description in the PDF.
UPDATE "QuoteItem" SET "description" = NULL;
UPDATE "InvoiceItem" SET "description" = NULL;
UPDATE "RecurringInvoiceItem" SET "description" = NULL;
