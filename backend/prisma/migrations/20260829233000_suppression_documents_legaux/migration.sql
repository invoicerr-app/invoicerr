-- Suppression des documents légaux et du moteur de conformité.
--
-- Décision explicite de l'utilisateur après avoir vu le coût : devis, factures, paiements, reçus,
-- ainsi que les 72 000 lignes du moteur (profils pays, machine à états, canaux, formats, archivage)
-- qui n'existaient que pour eux. Le repère git `avant-refonte-documents` conserve l'état antérieur.
--
-- CASCADE parce que ces tables se référencent entre elles ; l'ordre n'a donc pas à être deviné.

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
