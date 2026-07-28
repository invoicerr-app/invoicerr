-- II.5 Shared document data-model fields
-- Additive, data-preserving: new columns only (nullable, have defaults). No DROP or destructive change.
-- - DocumentKind enum for Invoice taxonomy (INVOICE/CREDIT_NOTE/DEBIT_NOTE/CORRECTIVE_INVOICE/PROFORMA/DEPOSIT/FINAL)
-- - Correction/deposit self-relations on Invoice
-- - Buyer reference / PO / contract ref (EN 16931 BT-13)
-- - Delivery info (date + address block)
-- - Payment terms + means code
-- - FX rate + converted tax amount
-- - TTC pricing flag
-- - Line-level discount/allowance/charges + unit of measure code (EN 16931)

-- 1. Create DocumentKind enum
CREATE TYPE "DocumentKind" AS ENUM ('INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'CORRECTIVE_INVOICE', 'PROFORMA', 'DEPOSIT', 'FINAL');

-- 2. Add columns to Invoice
ALTER TABLE "Invoice"
  ADD COLUMN "kind" "DocumentKind" NOT NULL DEFAULT 'INVOICE',
  ADD COLUMN "correctsInvoiceId" TEXT,
  ADD COLUMN "depositOfInvoiceId" TEXT,
  ADD COLUMN "buyerReference" TEXT,
  ADD COLUMN "purchaseOrder" TEXT,
  ADD COLUMN "contractRef" TEXT,
  ADD COLUMN "deliveryDate" TIMESTAMP(3),
  ADD COLUMN "deliveryAddress" TEXT,
  ADD COLUMN "deliveryAddressLine2" TEXT,
  ADD COLUMN "deliveryPostalCode" TEXT,
  ADD COLUMN "deliveryCity" TEXT,
  ADD COLUMN "deliveryState" TEXT,
  ADD COLUMN "deliveryCountry" TEXT,
  ADD COLUMN "paymentTerms" TEXT,
  ADD COLUMN "paymentMeansCode" TEXT,
  ADD COLUMN "fxRate" DOUBLE PRECISION,
  ADD COLUMN "fxTaxAmount" DOUBLE PRECISION,
  ADD COLUMN "fxTaxAmountMinor" INTEGER,
  ADD COLUMN "ttcPricing" BOOLEAN NOT NULL DEFAULT false;

-- 3. Add columns to Quote
ALTER TABLE "Quote"
  ADD COLUMN "buyerReference" TEXT,
  ADD COLUMN "purchaseOrder" TEXT,
  ADD COLUMN "deliveryDate" TIMESTAMP(3),
  ADD COLUMN "deliveryAddress" TEXT,
  ADD COLUMN "deliveryAddressLine2" TEXT,
  ADD COLUMN "deliveryPostalCode" TEXT,
  ADD COLUMN "deliveryCity" TEXT,
  ADD COLUMN "deliveryState" TEXT,
  ADD COLUMN "deliveryCountry" TEXT,
  ADD COLUMN "paymentTerms" TEXT,
  ADD COLUMN "paymentMeansCode" TEXT,
  ADD COLUMN "fxRate" DOUBLE PRECISION,
  ADD COLUMN "fxTaxAmount" DOUBLE PRECISION,
  ADD COLUMN "fxTaxAmountMinor" INTEGER,
  ADD COLUMN "ttcPricing" BOOLEAN NOT NULL DEFAULT false;

-- 4. Add columns to InvoiceItem
ALTER TABLE "InvoiceItem"
  ADD COLUMN "discountRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "discountAmount" DOUBLE PRECISION,
  ADD COLUMN "discountAmountMinor" INTEGER,
  ADD COLUMN "chargeAmount" DOUBLE PRECISION,
  ADD COLUMN "chargeAmountMinor" INTEGER,
  ADD COLUMN "chargeDescription" TEXT,
  ADD COLUMN "unitOfMeasure" TEXT NOT NULL DEFAULT 'C62';

-- 5. Add columns to QuoteItem
ALTER TABLE "QuoteItem"
  ADD COLUMN "discountRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "discountAmount" DOUBLE PRECISION,
  ADD COLUMN "discountAmountMinor" INTEGER,
  ADD COLUMN "chargeAmount" DOUBLE PRECISION,
  ADD COLUMN "chargeAmountMinor" INTEGER,
  ADD COLUMN "chargeDescription" TEXT,
  ADD COLUMN "unitOfMeasure" TEXT NOT NULL DEFAULT 'C62';

-- 6. Add self-referential FK constraints on Invoice (ON DELETE SET NULL — issued docs are never hard-deleted)
ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_correctsInvoiceId_fkey"
    FOREIGN KEY ("correctsInvoiceId") REFERENCES "Invoice"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_depositOfInvoiceId_fkey"
    FOREIGN KEY ("depositOfInvoiceId") REFERENCES "Invoice"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
