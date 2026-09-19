-- Restores pre-refonte quote/invoice numbering for any company that never explicitly chose a
-- `Company.numberFormats` entry for that type. See `Company.numberFormats`'s own schema.prisma
-- comment: a Prisma query extension used to read the six `quote/invoice/paymentStartingNumber` /
-- `*NumberFormat` columns below; it was removed on this branch (never released — see the
-- `avant-refonte-documents` git tag), and migrating their last value into `numberFormats` was left
-- as "a separate cleanup". This is that cleanup.
--
-- Deliberately CONDITIONAL ("only where absent" — the `? 'quote'` / `? 'invoice'` existence check
-- below): a company that already has an explicit `numberFormats.quote`/`.invoice` entry (written
-- through `PUT /api/company/number-format`, e.g. a Portuguese company's ATCUD series) keeps it
-- completely untouched. Sequential, unbroken document numbering is a legal requirement in every
-- country this product supports — silently changing an in-use prefix mid-migration would be a real
-- incident, not a cleanup, which is exactly why this never overwrites an explicit choice.
--
-- Only "quote" and "invoice" are migrated: those are the only two `DocumentTypeDescriptor` ids that
-- declare `numbering` at all (documents/descriptors/quote.descriptor.ts and invoice.descriptor.ts —
-- see descriptors/types.ts's own header on `DocumentTypeDescriptor.numbering`). There is no "payment"
-- document type in this rewrite: recording a payment is `invoice`'s own "record-payment" action
-- (invoice.descriptor.ts), never a separately-numbered document — `credit-note`, `expense` and
-- `received-invoice` don't declare `numbering` either, for the same reason. Migrating
-- `paymentNumberFormat`/`paymentStartingNumber` under a `numberFormats.payment` key would invent a
-- key nothing in this codebase ever reads — exactly the "guess" this migration is written to avoid;
-- it is left in place, unmigrated, alongside the other five now write-dead legacy columns.
UPDATE "Company"
SET "numberFormats" = COALESCE("numberFormats", '{}'::jsonb)
  || jsonb_build_object('quote', "quoteNumberFormat")
WHERE NOT (COALESCE("numberFormats", '{}'::jsonb) ? 'quote');

UPDATE "Company"
SET "numberFormats" = COALESCE("numberFormats", '{}'::jsonb)
  || jsonb_build_object('invoice', "invoiceNumberFormat")
WHERE NOT (COALESCE("numberFormats", '{}'::jsonb) ? 'invoice');
