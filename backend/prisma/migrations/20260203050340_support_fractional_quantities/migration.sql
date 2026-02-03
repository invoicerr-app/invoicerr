/*
  Warnings:

  - Changed the type of `quantity` on the `InvoiceItem` table from Int to Float. Existing data is preserved through type casting.
  - Changed the type of `quantity` on the `QuoteItem` table from Int to Float. Existing data is preserved through type casting.
  - Changed the type of `quantity` on the `RecurringInvoiceItem` table from Int to Float. Existing data is preserved through type casting.

*/
-- AlterTable
ALTER TABLE "public"."InvoiceItem" ALTER COLUMN "quantity" TYPE DOUBLE PRECISION USING "quantity"::DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "public"."QuoteItem" ALTER COLUMN "quantity" TYPE DOUBLE PRECISION USING "quantity"::DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "public"."RecurringInvoiceItem" ALTER COLUMN "quantity" TYPE DOUBLE PRECISION USING "quantity"::DOUBLE PRECISION;
