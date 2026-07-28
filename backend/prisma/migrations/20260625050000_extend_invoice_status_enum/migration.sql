-- Extend InvoiceStatus with issuance lifecycle values (III.1 reconciliation).
-- Additive only: no existing values are removed or renamed.
-- PENDING_CLEARANCE / CLEARED are placeholders for clearance countries (PART X).

ALTER TYPE "InvoiceStatus" ADD VALUE 'ISSUED';
ALTER TYPE "InvoiceStatus" ADD VALUE 'PENDING_CLEARANCE';
ALTER TYPE "InvoiceStatus" ADD VALUE 'CLEARED';
ALTER TYPE "InvoiceStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "InvoiceStatus" ADD VALUE 'CORRECTED';
