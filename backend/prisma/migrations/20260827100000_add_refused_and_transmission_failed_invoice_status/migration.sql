-- F-008 residual: REJECTED was made visible on the invoice, but two sibling outcomes were not.
--
--   REFUSED             the BUYER declined a correctly transmitted invoice
--   TRANSMISSION_FAILED it never reached the authority at all
--
-- Both left the invoice showing SENT, for the same reason REJECTED did: nothing projected
-- ComplianceDocument.status onto Invoice.status. They are distinct facts from an authority
-- rejection and need their own wording, which is why they get their own values rather than being
-- folded into REJECTED.
--
-- Additive only: no existing value is removed or renamed, and no row is rewritten.

ALTER TYPE "InvoiceStatus" ADD VALUE 'REFUSED';
ALTER TYPE "InvoiceStatus" ADD VALUE 'TRANSMISSION_FAILED';
