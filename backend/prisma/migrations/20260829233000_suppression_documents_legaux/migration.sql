-- Removal of the legal documents and the compliance engine.
--
-- A deliberate decision taken once the cost was visible: quotes, invoices, payments, receipts, and
-- the 72 000 lines of engine that existed only for them -- country profiles, state machine,
-- channels, formats, archiving. Git tag `avant-refonte-documents` preserves the prior state for
-- anyone doing archaeology.
--
-- CASCADE because these tables reference one another, so the drop order does not have to be guessed
-- correctly.

DROP TABLE IF EXISTS "InboundInvoice" CASCADE;
DROP TABLE IF EXISTS "CompanySigningCertificate" CASCADE;
DROP TABLE IF EXISTS "CompanyChannelConfig" CASCADE;
DROP TABLE IF EXISTS "ComplianceReport" CASCADE;
DROP TABLE IF EXISTS "ComplianceInboundMessage" CASCADE;
DROP TABLE IF EXISTS "ComplianceCallbackRegistration" CASCADE;
DROP TABLE IF EXISTS "ScheduledJob" CASCADE;
DROP TABLE IF EXISTS "ComplianceAuthorityId" CASCADE;
DROP TABLE IF EXISTS "ComplianceEvent" CASCADE;
DROP TABLE IF EXISTS "ComplianceDocument" CASCADE;
DROP TABLE IF EXISTS "VatRate" CASCADE;
DROP TABLE IF EXISTS "CurrencyConversion" CASCADE;
DROP TABLE IF EXISTS "PdfDownloadToken" CASCADE;
DROP TABLE IF EXISTS "Signature" CASCADE;
DROP TABLE IF EXISTS "PaymentMethod" CASCADE;
DROP TABLE IF EXISTS "PaymentItem" CASCADE;
DROP TABLE IF EXISTS "Payment" CASCADE;
DROP TABLE IF EXISTS "RecurringInvoiceItem" CASCADE;
DROP TABLE IF EXISTS "RecurringInvoice" CASCADE;
DROP TABLE IF EXISTS "InvoiceItem" CASCADE;
DROP TABLE IF EXISTS "Invoice" CASCADE;
DROP TABLE IF EXISTS "QuoteItem" CASCADE;
DROP TABLE IF EXISTS "Quote" CASCADE;
DROP TABLE IF EXISTS "NumberSeries" CASCADE;
DROP TABLE IF EXISTS "PDFConfig" CASCADE;
