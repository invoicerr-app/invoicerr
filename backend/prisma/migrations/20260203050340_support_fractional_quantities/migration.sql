/*
  Warnings:

  - Changed the type of `quantity` on the `InvoiceItem` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `quantity` on the `QuoteItem` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `quantity` on the `RecurringInvoiceItem` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "public"."InvoiceItem" ALTER COLUMN "quantity" TYPE DOUBLE PRECISION USING "quantity"::DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "public"."QuoteItem" ALTER COLUMN "quantity" TYPE DOUBLE PRECISION USING "quantity"::DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "public"."RecurringInvoiceItem" ALTER COLUMN "quantity" TYPE DOUBLE PRECISION USING "quantity"::DOUBLE PRECISION;
