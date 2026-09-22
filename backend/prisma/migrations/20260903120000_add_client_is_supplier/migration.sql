-- Supplier reconciliation for received invoices reuses "Client" with a role, carried by a SEPARATE
-- boolean and never by extending "kind". See the `isSupplier` field's own comment in schema.prisma
-- for the WHY: kind/GOVERNMENT is a B2G ROUTING fact, while "is a supplier of this company" is an
-- ORTHOGONAL fact about the INBOUND direction. A client can be both at once, and "kind" cannot carry
-- two independent facts without composite values.
--
-- DEFAULT false, NOT NULL is the deliberate backfill: no EXISTING client is a supplier until
-- reconciliation says so explicitly, automatically or by hand
-- (received-invoices/supplier-reconciliation.ts). Purely additive; this migration never sets it.
ALTER TABLE "Client" ADD COLUMN "isSupplier" BOOLEAN NOT NULL DEFAULT false;
