-- The VAT category as RESOLVED BY THE ENGINE, and its exemption reason.
--
-- Both nullable, and null means "resolved before this column existed" — not "no category". The
-- renderer refuses a null rather than falling back to the rate, because falling back to the rate is
-- the defect these columns exist to remove: Z, E, AE, K, G and O all carry rate 0 and demand
-- contradictory things of the document (BR-Z-02 requires the seller VAT id, BR-O-02 forbids it).
ALTER TABLE "InvoiceItem" ADD COLUMN "vatCategory" TEXT;
ALTER TABLE "InvoiceItem" ADD COLUMN "vatExemptionReason" TEXT;
