-- Closes the gap `20260829233000_suppression_documents_legaux`'s own header named and left open on
-- purpose: at THAT migration's point in history, `DocumentInstance.number`/`displayNumber`
-- (`$20260830230834_document_numbering`), `DocumentPayment` (`$20260831013704_add_document_payments`)
-- and the documentId-keyed `Signature` table (`$20260910120000_reintroduce_hardened_signature`) did
-- not exist yet, so the backfill parked the raw facts as undeclared `data` keys instead:
-- `legacyNumber`, `legacyRawNumber`, `legacyPayments`, `legacySignedAt` (plus `legacyStatus`,
-- `legacyDiscountRate`, `legacyValidUntil`, `legacySignedBy`, which this migration deliberately does
-- NOT touch — see "What stays parked" below). By now every real destination exists, so this migration
-- reads those keys back off `DocumentInstance.data` and writes them into the real columns/table a
-- migrated invoice or quote needs to show its actual number and balance again.
--
-- ## No-op on a fresh install (constraint 1)
--
-- Every block below is keyed off `"data" ? 'legacyXxx'` — a database that never had legacy Invoice/
-- Quote rows has no such keys on any `DocumentInstance`, so every `WHERE` here matches zero rows and
-- every INSERT/UPDATE is a genuine no-op. No `to_regclass` guard is needed the way the PARENT
-- migration needed one for "Invoice"/"Quote": `DocumentInstance` itself is a core table that has
-- existed since the initial migration and is never dropped, so referencing it can never fail here.
--
-- ## Idempotent (constraint 2)
--
-- Three independent guards, one per destination, deliberately NOT relying on deleting the `legacy*`
-- keys once consumed (see "Keeping the legacy* keys" below for why):
--  - `DocumentNumberSequence`: `ON CONFLICT ... DO UPDATE SET "nextNumber" = GREATEST(...)` is a pure
--    ratchet over a value recomputed identically every run from the immutable `legacyNumber` facts —
--    safe to run any number of times, in any order relative to the other two blocks.
--  - `DocumentInstance.number`/`displayNumber`: gated on `"number" IS NULL`. A first run sets it; a
--    second run (or a company that has since had a human correct its number by hand) sees a non-null
--    `number` and skips — this is the SAME database-level "never overwrite" discipline
--    `numbering/sequence.ts#takeDocumentNumber` already holds for a live write, applied here to a
--    batch one.
--  - `DocumentPayment`/`Signature`: each restored row keeps its SOURCE id (the original `Payment.id`,
--    or a deterministic `'legacy-signature:' || documentId` for the quote signature — there is no
--    source `Signature.id` to reuse, since the OLD `Signature` model's own rows were dropped
--    unconditionally by the parent migration without being preserved even as JSON; only `Quote.
--    signedAt`/`signedBy` survived, see that migration's own header). `ON CONFLICT (id) DO NOTHING`
--    makes a second run insert nothing new — the exact "keep the source id, ON CONFLICT DO NOTHING is
--    belt-and-suspenders" convention the parent migration itself established for `DocumentInstance`.
--
-- ## Keeping the legacy* keys (constraint 5 — argued, not asserted)
--
-- This migration does NOT delete `legacyNumber`/`legacyRawNumber`/`legacyPayments`/`legacySignedAt`
-- once restored. Three reasons:
--  1. Idempotency does not need it — see above, every destination already guards itself.
--  2. They are the ONLY surviving copy of facts whose source tables are already gone: the original
--     `Payment.id`/`paymentDetails` verbatim, the per-item `PaymentItem` allocation (never carried
--     into `DocumentPayment`, which has no per-line concept — see the parent migration's own header),
--     `legacySignedBy` (no field on the new `Signature` model at all, see below). Deleting the keys
--     the moment the PART of them that DOES have a home is consumed would throw away the part that
--     does not, for no benefit.
--  3. A payment or signature this migration could not confidently restore (malformed/unparseable —
--     see "Never invent" below) is left in `data` verbatim specifically so a human can still recover
--     it; silently deleting the surrounding key on partial success would bury exactly the row that
--     most needs a human's attention.
-- Storage cost is a handful of bytes per document — negligible next to the alternative of losing
-- audit trail for no idempotency gain.
--
-- ## Never invent (constraint 3)
--
-- A `legacyPayments` entry is restored only when BOTH `totalPaid` and `paidAt` parse cleanly (the
-- exact shape the parent migration's own `to_char(..., 'YYYY-MM-DD HH24:MI:SS')`/plain-numeric
-- `jsonb_build_object` calls always produce for a real row) — checked with an anchored regex rather
-- than a bare `::numeric`/`::timestamp` cast so a malformed entry is SKIPPED, not a fatal error that
-- would abort the whole migration. Skipped rows are left untouched in `data.legacyPayments` (per
-- "Keeping the legacy* keys" above) and counted in a `RAISE NOTICE`, never guessed at. Same discipline
-- for `legacySignedAt`.
--
-- `paidAt`'s stored precision is already limited to whole seconds — an unavoidable consequence of the
-- PARENT migration's own `to_char(..., 'YYYY-MM-DD HH24:MI:SS')` format (no fractional-second token),
-- not a choice this migration makes; noted here rather than silently accepted, per this codebase's own
-- "call out precision loss" discipline (see `DocumentPayment.conversionRateAsOf`'s own header for the
-- same posture on a different field).
--
-- `DocumentPayment.currency`/`documentAmountMinor`: every legacy `Payment` was, by construction,
-- recorded in its own invoice's currency (the OLD schema had no separate payment-currency column at
-- all — see `avant-refonte-documents:backend/prisma/schema.prisma`'s own `Payment` model), so
-- `documentAmountMinor` always equals `amountMinor` and `conversionRate`/`conversionRateAsOf`/
-- `conversionSource` stay NULL — the exact "never converted" case
-- `20260902234040_payment_conversion_and_document_settled`'s own header already backfills the same
-- way for every `DocumentPayment` row that predates the conversion feature. `amountMinor` itself is
-- computed with the SAME per-currency decimal table `backend/src/utils/financial.ts#toMinor` uses
-- (JPY/KRW = 0 decimals, KWD/BHD/OMR/TND = 3, everything else = 2), reproduced here as a multiplier
-- CASE in plain `numeric` arithmetic (never `float`) so `round()` matches `Math.round()`'s
-- round-half-away-from-zero behavior on the positive amounts a recorded payment always is.
--
-- `method`: not an enum anywhere (`DocumentPayment.method`/old `Payment.paymentMethod` are both plain
-- strings, and `invoice-actions.ts`'s own "record-payment" handler does not validate against its
-- descriptor's `select` options either — confirmed by reading that handler, not assumed), so the old
-- value is carried through VERBATIM, `NULLIF(..., '')` only turning the old column's own
-- `@default("")` empty string into a real `NULL` (semantically identical, never a guess).
--
-- `PaymentItem`'s per-line allocation and `Quote.validUntil`/`signedBy` are NOT restored: no field on
-- `DocumentPayment` or the new `Signature` model exists to hold either (see the parent migration's own
-- header on the first two; the new `Signature` model — schema.prisma — simply has no signer-identity
-- column at all). Left in `data` untouched, same as `legacyDiscountRate`/`legacyStatus`, which this
-- migration does not touch either — neither was named as a gap to close.
--
-- ## The restored `Signature` row
--
-- Mirrors exactly what a REAL sign does (`signatures/signature.persistence.ts#markSignatureSigned`:
-- `{ signedAt: new Date(), isActive: false }`) — `signedAt` from `legacySignedAt`, `isActive: false`
-- (a signed link is never replayable, restored or not). `tokenHash` is `Signature`'s one NOT NULL
-- secret column with no historical value to restore (the OLD `Signature` row that once held a real
-- token was dropped without a JSON trace, see above) — filled with `gen_random_uuid()::text`, a
-- synthetic placeholder that satisfies the column's own uniqueness/NOT NULL constraint and is never
-- presented to, or checked against, any real request (there is no live OTP flow pointing at a restored
-- row: `otpCodeHash`/`otpExpiresAt` stay NULL and `isActive` is false from the moment it is inserted).
DO $$
DECLARE
  restored_numbers    INTEGER;
  missing_raw_number  INTEGER;
  restored_payments   INTEGER;
  skipped_payments    INTEGER;
  restored_signatures INTEGER;
  skipped_signatures  INTEGER;
BEGIN
  -- ## 1. Number sequences — bump BEFORE writing `number`, so a company's NEXT invoice/quote can
  -- never collide with a restored legacy one. Only "invoice" and "quote" ever declare `numbering`
  -- (descriptors/invoice.descriptor.ts, quote.descriptor.ts) and only those two typeIds are ever
  -- given a `legacyNumber` by the parent migration, but the filter is kept explicit anyway — the same
  -- defensive "state the invariant, don't just rely on it" posture the rest of this module holds.
  INSERT INTO "DocumentNumberSequence" ("companyId", "typeId", "nextNumber")
  SELECT d."companyId", d."typeId", max((d."data" ->> 'legacyNumber')::int) + 1
  FROM "DocumentInstance" d
  WHERE d."data" ? 'legacyNumber' AND d."typeId" IN ('invoice', 'quote')
  GROUP BY d."companyId", d."typeId"
  ON CONFLICT ("companyId", "typeId")
  DO UPDATE SET "nextNumber" = GREATEST("DocumentNumberSequence"."nextNumber", EXCLUDED."nextNumber");

  -- ## 2. The number itself — `"number" IS NULL` is what makes this idempotent AND safe against a
  -- number a human has since corrected by hand (constraint 2). `displayNumber` comes from
  -- `legacyRawNumber` verbatim (that key IS the already-formatted string the old numbering hooks
  -- produced — see this file's header) — never reformatted here, matching `format-number.ts`'s own
  -- "frozen at issuance" discipline for the live path.
  WITH restored AS (
    UPDATE "DocumentInstance"
    SET "number" = ("data" ->> 'legacyNumber')::int,
        "displayNumber" = "data" ->> 'legacyRawNumber'
    WHERE "data" ? 'legacyNumber' AND "typeId" IN ('invoice', 'quote') AND "number" IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO restored_numbers FROM restored;

  -- A `legacyNumber` with no matching `legacyRawNumber` should never happen in practice — the OLD
  -- Prisma extension self-healed `rawNumber` onto every numbered row the moment it was next read or
  -- written (`avant-refonte-documents:backend/src/prisma/prisma.service.ts`'s own `findMany`/`create`/
  -- `update` hooks) — but `jsonb_strip_nulls` in the parent migration means a genuinely-null
  -- `rawNumber` would simply be an absent key here, and `->>` on an absent key returns NULL rather
  -- than erroring, so such a row still gets its `number` restored (never invented: a real, structured
  -- fact) with `displayNumber` left NULL rather than a fabricated string. Counted, not silently
  -- accepted.
  SELECT count(*) INTO missing_raw_number
  FROM "DocumentInstance"
  WHERE "data" ? 'legacyNumber' AND "typeId" IN ('invoice', 'quote') AND NOT ("data" ? 'legacyRawNumber');

  RAISE NOTICE '[restore] % DocumentInstance row(s) had number/displayNumber restored from legacy* '
    'keys (% of them had no legacyRawNumber to restore displayNumber from, and were left with '
    'displayNumber = NULL rather than a fabricated string).', restored_numbers, missing_raw_number;

  -- ## 3. Payments — restore the WHOLE-document facts `legacyPayments` carries onto `DocumentPayment`,
  -- exactly as "record-payment" itself would have written them (settlement/payments.ts#recordPayment)
  -- for a same-currency, non-converted payment. Anchored regexes (not bare casts) so a malformed entry
  -- is skipped, never a fatal error aborting the transaction — see this file's header's "Never invent".
  WITH candidates AS (
    SELECT
      d.id                                    AS document_id,
      d."companyId"                           AS company_id,
      d."data" ->> 'currency'                 AS currency,
      item ->> 'id'                           AS payment_id,
      item ->> 'totalPaid'                    AS total_paid_raw,
      item ->> 'paidAt'                       AS paid_at_raw,
      NULLIF(item ->> 'paymentMethod', '')    AS method,
      NULLIF(item ->> 'paymentDetails', '')   AS note
    FROM "DocumentInstance" d,
         LATERAL jsonb_array_elements(d."data" -> 'legacyPayments') AS item
    WHERE d."data" ? 'legacyPayments' AND d."typeId" = 'invoice'
  ),
  checked AS (
    SELECT
      *,
      (payment_id IS NOT NULL)
        AND (currency IS NOT NULL)
        AND (total_paid_raw ~ '^-?[0-9]+(\.[0-9]+)?$')
        AND (paid_at_raw ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$') AS is_valid
    FROM candidates
  ),
  to_insert AS (
    SELECT
      payment_id,
      company_id,
      document_id,
      round(
        total_paid_raw::numeric *
        CASE upper(currency)
          WHEN 'JPY' THEN 1
          WHEN 'KRW' THEN 1
          WHEN 'KWD' THEN 1000
          WHEN 'BHD' THEN 1000
          WHEN 'OMR' THEN 1000
          WHEN 'TND' THEN 1000
          ELSE 100
        END
      )::int AS amount_minor,
      currency,
      method,
      paid_at_raw::timestamp AS paid_at,
      note
    FROM checked
    WHERE is_valid
  ),
  inserted AS (
    INSERT INTO "DocumentPayment"
      (id, "companyId", "documentId", "amountMinor", currency, "documentAmountMinor",
       "conversionRate", "conversionRateAsOf", "conversionSource", method, "paidAt", note, "createdAt")
    SELECT
      payment_id,
      company_id,
      document_id,
      amount_minor,
      currency,
      amount_minor, -- documentAmountMinor: never converted, see this file's header
      NULL, NULL, NULL,
      method,
      paid_at,
      note,
      paid_at -- createdAt: the old Payment.createdAt was never captured into legacyPayments (only
              -- paidAt was) — paidAt is the best available historical timestamp, an approximation
              -- stated here rather than silently defaulting to "now" (this column's own @default).
    FROM to_insert
    ON CONFLICT (id) DO NOTHING
    RETURNING 1
  )
  -- Both counts read from CTEs of this SAME statement — `checked`/`inserted` are not visible to a
  -- later, separate statement, only within the one WITH chain that declares them.
  SELECT (SELECT count(*) FROM inserted), (SELECT count(*) FROM checked WHERE NOT is_valid)
  INTO restored_payments, skipped_payments;

  IF skipped_payments > 0 THEN
    RAISE NOTICE '[restore] % legacyPayments entr(y/ies) could NOT be restored to DocumentPayment — '
      'missing/unparseable id, currency, totalPaid or paidAt. Left untouched in '
      'DocumentInstance.data.legacyPayments for manual recovery.', skipped_payments;
  END IF;
  RAISE NOTICE '[restore] % DocumentPayment row(s) restored from legacyPayments.', restored_payments;

  -- ## 4. Signatures — one row per SIGNED quote, mirroring `markSignatureSigned`'s own write exactly
  -- (`{ signedAt, isActive: false }` — see this file's header). Only "quote" ever carries
  -- `legacySignedAt` (the parent migration never writes it for an invoice).
  WITH candidates AS (
    SELECT
      d.id                          AS document_id,
      d."companyId"                 AS company_id,
      d."data" ->> 'legacySignedAt' AS signed_at_raw
    FROM "DocumentInstance" d
    WHERE d."typeId" = 'quote' AND d."data" ? 'legacySignedAt'
  ),
  checked AS (
    SELECT *, (signed_at_raw ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$') AS is_valid
    FROM candidates
  ),
  inserted AS (
    INSERT INTO "Signature"
      (id, "companyId", "typeId", "documentId", "tokenHash", "signedAt", "isActive",
       "createdAt", "updatedAt")
    SELECT
      'legacy-signature:' || document_id,
      company_id,
      'quote',
      document_id,
      gen_random_uuid()::text, -- synthetic placeholder secret — see this file's header
      signed_at_raw::timestamp,
      false,                   -- a restored signature is exactly as non-replayable as a real one
      signed_at_raw::timestamp,
      signed_at_raw::timestamp
    FROM checked
    WHERE is_valid
    ON CONFLICT (id) DO NOTHING
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM inserted), (SELECT count(*) FROM checked WHERE NOT is_valid)
  INTO restored_signatures, skipped_signatures;

  IF skipped_signatures > 0 THEN
    RAISE NOTICE '[restore] % legacySignedAt value(s) could NOT be restored to Signature — '
      'unparseable timestamp. Left untouched in DocumentInstance.data.legacySignedAt for manual '
      'recovery.', skipped_signatures;
  END IF;
  RAISE NOTICE '[restore] % Signature row(s) restored from legacySignedAt (quote e-signatures).',
    restored_signatures;
END $$;
