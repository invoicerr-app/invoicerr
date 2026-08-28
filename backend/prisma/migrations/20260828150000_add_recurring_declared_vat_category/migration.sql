-- The same declaration as InvoiceItem, on the template that generates invoices.
--
-- Without it a recurring line at 0% in a country that levies no zero rate resolves to E on every
-- generated invoice, BR-E-10 refuses it at issuance, and nothing on the template can supply the
-- reason. With autoIssue on, that failure is caught and the invoice "stays DRAFT, retried next
-- run" — an unwatched loop rather than a visible error.
--
-- Nullable; null means "not declared" and the engine derives exactly as before.
ALTER TABLE "RecurringInvoiceItem" ADD COLUMN "requestedVatCategory" TEXT;
ALTER TABLE "RecurringInvoiceItem" ADD COLUMN "requestedVatExemptionReason" TEXT;
