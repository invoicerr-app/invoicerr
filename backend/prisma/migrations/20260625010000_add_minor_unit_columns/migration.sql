-- Additive: integer-minor-unit columns for money fields (Phase 1 of Float→int migration)
-- Nullable, no default — backfilled in a subsequent script.

ALTER TABLE "Quote"        ADD COLUMN "totalHTMinor"  INTEGER;
ALTER TABLE "Quote"        ADD COLUMN "totalVATMinor" INTEGER;
ALTER TABLE "Quote"        ADD COLUMN "totalTTCMinor" INTEGER;
ALTER TABLE "QuoteItem"    ADD COLUMN "unitPriceMinor" INTEGER;

ALTER TABLE "Invoice"           ADD COLUMN "totalHTMinor"  INTEGER;
ALTER TABLE "Invoice"           ADD COLUMN "totalVATMinor" INTEGER;
ALTER TABLE "Invoice"           ADD COLUMN "totalTTCMinor" INTEGER;
ALTER TABLE "InvoiceItem"       ADD COLUMN "unitPriceMinor" INTEGER;

ALTER TABLE "RecurringInvoice"      ADD COLUMN "totalHTMinor"  INTEGER;
ALTER TABLE "RecurringInvoice"      ADD COLUMN "totalVATMinor" INTEGER;
ALTER TABLE "RecurringInvoice"      ADD COLUMN "totalTTCMinor" INTEGER;
ALTER TABLE "RecurringInvoiceItem"  ADD COLUMN "unitPriceMinor" INTEGER;

ALTER TABLE "Payment"       ADD COLUMN "totalPaidMinor"  INTEGER;
ALTER TABLE "PaymentItem"   ADD COLUMN "amountPaidMinor" INTEGER;

ALTER TABLE "Article"       ADD COLUMN "unitPriceMinor" INTEGER;
