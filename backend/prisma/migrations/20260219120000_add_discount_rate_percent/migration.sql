-- Add discountRate percentage fields for quotes and invoices
ALTER TABLE "Quote" ADD COLUMN "discountRate" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN "discountRate" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Add configurable label for discount rows in PDF templates
ALTER TABLE "PDFConfig" ADD COLUMN "discount" TEXT NOT NULL DEFAULT 'Discount:';
