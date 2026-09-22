-- Durable, cross-process proof that a document's delivery (actions/async-send.ts's phase-2
-- `deliver()`) has already succeeded, written BEFORE the record ever moves to "sent" — see
-- schema.prisma's own comment on `DocumentInstance.deliveryConfirmedAt` for the full guarantee this
-- closes. Nullable and additive: every existing row gets NULL, which reads as "no delivery confirmed
-- yet" for a document already "sent" long before this column existed — harmless, since a document
-- that already reached "sent" never re-enters "sending" through this action again.
ALTER TABLE "DocumentInstance" ADD COLUMN "deliveryConfirmedAt" TIMESTAMP(3);
