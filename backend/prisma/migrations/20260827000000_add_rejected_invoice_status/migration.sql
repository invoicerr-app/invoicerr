-- F-008: an authority rejection was invisible on the invoice the user actually looks at.
--
-- `ComplianceDocument.status` already had REJECTED, but nothing ever projected it onto
-- `Invoice.status`, so an invoice rejected by KSeF or refused by the SdI kept showing as
-- SENT/ISSUED in the invoice list. The rejection existed only in a table the main screen
-- does not read, and the user believed they had invoiced.
--
-- Additive only: no existing value is removed or renamed, and no row is rewritten. Existing
-- invoices keep the status they have — this migration opens the value, the projection in
-- ApplySignalService writes it from here on.

ALTER TYPE "InvoiceStatus" ADD VALUE 'REJECTED';
