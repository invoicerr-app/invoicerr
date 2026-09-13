-- Removal of the legal documents and the compliance engine.
--
-- A deliberate decision taken once the cost was visible: quotes, invoices, payments, receipts, and
-- the 72 000 lines of engine that existed only for them -- country profiles, state machine,
-- channels, formats, archiving. Git tag `avant-refonte-documents` preserves the prior state for
-- anyone doing archaeology.
--
-- CASCADE because these tables reference one another, so the drop order does not have to be guessed
-- correctly.
--
-- ## Backfill: Invoice/Quote history -> DocumentInstance, BEFORE any of the drops below (2026-09-13)
--
-- The plain drop, unmodified, silently destroyed every self-hosted install's invoicing history on
-- its first upgrade past this branch — reproduced end to end against a throwaway database built the
-- way a real pre-v1.4.4a install looks: two invoices in, zero out, DocumentInstance empty. This
-- block is the fix, on the exact model $20260830105720_migrate_expenses_to_documents already used
-- for `Expense`: an `INSERT ... SELECT` into "DocumentInstance", run while the source tables still
-- exist, immediately above the DROP TABLE statements that remove them.
--
-- This migration has never shipped (neither `origin/main` nor `origin/dev` contains it), so editing
-- it in place — rather than adding a new one — changes no released checksum.
--
-- Guarded on `to_regclass('"Invoice"') IS NOT NULL`, exactly like `DROP TABLE IF EXISTS` already
-- tolerates absence for the DROPs below: a genuine no-op on a fresh install where "Invoice" never
-- existed. Idempotent: every inserted row keeps its SOURCE id (Invoice.id / Quote.id) as its own
-- "DocumentInstance".id (so foreign keys and user-facing links/URLs survive), `ON CONFLICT (id) DO
-- NOTHING` is belt-and-suspenders, and the DROP TABLE statements a few lines down remove the source
-- in the SAME script — so a second run of this file has nothing left under `to_regclass` to read at
-- all and skips this whole block.
--
-- Both `DocumentInstance` columns this table had at THIS point in migration history are used —
-- `id`/`companyId`/`typeId`/`status`/`data`/`createdAt`/`updatedAt`, nothing else: `number`/
-- `displayNumber` (numbering/), `DocumentPayment` (settlement/) and the new, documentId-keyed
-- `Signature` table do not exist yet — they land in `$20260830230834_document_numbering`,
-- `$20260831013704_add_document_payments` and `$20260910120000_reintroduce_hardened_signature`
-- respectively, all AFTER this one. That is not merely "not yet convenient": by the time each of
-- those migrations runs, "Invoice"/"Quote"/"Payment" are already gone (dropped right here), so none
-- of them could backfill from the source tables even if it tried — the exact "a later migration
-- cannot help, the tables are already gone by then" problem this whole backfill exists to avoid,
-- recurring one level down for the invoice number and for payments specifically. What this backfill
-- does about it: preserve the raw, otherwise-unreachable facts as extra, UNDECLARED `data` keys
-- (`legacyNumber`, `legacyRawNumber`, `legacyPayments`, ...) — "extra, undeclared keys ride along
-- verbatim" is an already-established convention here (see
-- documents.service.received-invoice.spec.ts) — so the fact is not silently gone, only not yet wired
-- into the numbering/settlement machinery that will exist a few migrations later. No code in this
-- branch reads these `legacy*` keys today; a future migration that backfills `number`/`displayNumber`
-- or seeds `DocumentPayment` from them is possible but is its own, separate piece of work.
--
-- ## What is deliberately NOT carried across, and why
--
--  - Only `Invoice.kind = 'INVOICE'` rows travel to typeId 'invoice'. The other five `DocumentKind`
--    values sharing this same table (CREDIT_NOTE, DEBIT_NOTE, CORRECTIVE_INVOICE, PROFORMA, DEPOSIT,
--    FINAL) are excluded, each for its own reason (see this migration's own PR/report for the full
--    account) — most importantly CREDIT_NOTE: `credit-note.descriptor.ts`'s own header states, in its
--    own words, that the OLD credit note had lines "structurally identical to the invoice's but with
--    NO TRACEABLE LINK back to which invoice line each row actually corresponded to" — exactly the
--    gap the NEW credit note's `correctedLines` ('rowSelection', REQUIRED) exists to close. There is
--    no honest value to put there for an old row; inventing row-selection ids after the fact would be
--    fabricating provenance for a legal document, which this codebase's own "kind: 'legal', quoting
--    the exact source text, or kind: 'unverified'" discipline (documents/*/DESIGN notes) exists
--    specifically to refuse elsewhere. A count of every excluded kind is raised as a NOTICE below so a
--    real upgrade is never silently missing rows.
--  - `RecurringInvoice`/`RecurringInvoiceItem`/`NumberSeries`: no Prisma model of any kind exists for
--    recurring generation any more (schema.prisma's own WebhookEvent purge comment: "the feature
--    itself has no `RecurringInvoice` Prisma model any more, superseded by the generic document
--    `schedules/cadence.ts`" — a DIFFERENT mechanism, re-running an EXISTING action on a cadence, not
--    "generate N fresh invoices from a stored template"). Every invoice a recurring template already
--    generated is a real, ordinary `kind = 'INVOICE'` row and IS migrated above; only the template
--    itself, and the counter, have nowhere to land.
--  - `Payment`/`PaymentItem`'s ROW-level shape (a header allocated across specific `PaymentItem`s) has
--    no equivalent at all: `DocumentPayment` (settlement/) records a payment against the WHOLE
--    document only, never a per-line allocation. The header fact (amount/method/date) is preserved
--    verbatim in `legacyPayments`; the per-item split is not, since there is nowhere to put it even as
--    an extra key without inventing a shape `DocumentPayment` does not have.
--  - Document-level `discountRate` (Invoice/Quote's own header field) has no equivalent: the new line
--    shape only has a PER-LINE `discountPercent`. Preserved verbatim as `legacyDiscountRate` (an
--    undeclared key) rather than distributed onto every line — mathematically that redistribution
--    would reproduce the same total when nothing else discounts the same base, but this backfill does
--    not assert that no old row ever combined a header-level rate with its own line-level ones in a
--    way this comment cannot verify from the schema alone, so it does not invent the combined figure.
--  - Quote-only facts with no field on the new type at all: `validUntil` (no expiry concept on
--    quote.descriptor.ts), the OLD `VIEWED`/`EXPIRED`/`REJECTED` statuses (collapsed into 'sent' below
--    — see the status CASE), and the audit trail of a signature (`signedAt`/`signedBy` preserved
--    verbatim as `legacy*` keys, but no matching row is created in the new, documentId-keyed
--    `Signature` table, which does not exist yet either — see above).
DO $$
DECLARE
  excluded_kind RECORD;
  recurring_count INTEGER;
  series_count INTEGER;
BEGIN
  IF to_regclass('"Invoice"') IS NULL THEN
    -- Fresh install: "Invoice" (and every sibling table this block reads) never existed.
    RETURN;
  END IF;

  -- ## Invoices ----------------------------------------------------------------------------------
  --
  -- Field-by-field mapping onto invoice.descriptor.ts's own declared shape (its `id` is read from
  -- that file, not guessed: 'invoice'):
  --  - status      <- InvoiceStatus, folded onto the five NEW lifecycle statuses (see the CASE):
  --                   DRAFT->draft, CANCELLED->cancelled, REJECTED/REFUSED/TRANSMISSION_FAILED
  --                   ->send_failed (all three mean "never successfully delivered"), everything else
  --                   (ISSUED/PAID/UNPAID/OVERDUE/SENT/ARCHIVED/PENDING_CLEARANCE/CLEARED/CORRECTED)
  --                   ->sent. The PAID/UNPAID/OVERDUE distinction specifically is not actually lost by
  --                   this collapse: the new model recomputes that same fact LIVE from
  --                   `DocumentPayment` rows (settlement/compute-settlement.ts) rather than storing it
  --                   as a status — it is relocated, not dropped (though see this block's own header
  --                   on why the payment ROWS themselves cannot be wired in from here yet).
  --  - data.client         <- "clientId" (a 'reference' field's stored value is a bare id string)
  --  - data.origin         <- {entity:'quote', id:"quoteId"}, only when "quoteId" is set — the ONE
  --                           reference `origin` can express; "recurringInvoiceId" has no matching
  --                           target and is dropped (see this migration's header on RecurringInvoice)
  --  - data.issueDate      <- COALESCE("issuedAt", "createdAt"): "issuedAt" is the real DRAFT->ISSUED
  --                           date but is null for a row still in DRAFT, which never crossed that
  --                           transition; "createdAt" is the only other honest date for that case, and
  --                           `issueDate` is REQUIRED on the new descriptor
  --  - data.dueDate        <- "dueDate" (NOT NULL already)
  --  - data.currency       <- "currency"::text (the SAME enum invoice.descriptor.ts's own
  --                           CURRENCY_OPTIONS is built from)
  --  - data.notes          <- "notes"
  --  - data.clientReference <- "buyerReference" ("PO / contract reference (EN 16931 BT-13)" — exactly
  --                           the fact `clientReference`'s own doc comment on invoice.descriptor.ts
  --                           describes: "the BUYER's own reference for this document")
  --  - data.lines          <- "InvoiceItem" rows, ordered by "order":
  --      - description      <- "name" (the line's designation; InvoiceItem's OWN separate, optional
  --                            "description" column has no second slot on the new line shape and is
  --                            NOT carried — the old free-text extra never had a traceable purpose
  --                            beyond decoration, unlike "name", which is what an Article's own `name`
  --                            already prefills into this exact field for a NEW line)
  --      - quantity/unitPrice <- "quantity"/"unitPrice" verbatim — both already MAJOR units on both
  --                            sides (the 'money' kind's own validator, field-kinds.ts, expects a
  --                            plain finite number, the same representation "unitPrice" already is)
  --      - unit             <- "unitOfMeasure"
  --      - vatRate          <- "vatRate" reformatted as JS's `String(number)` would (vat-rates/
  --                            registry.ts's `vatRateFieldOptions`: an option's `value` is
  --                            `String(rate.rate)`, and a 'select' field's stored value must match one
  --                            of its options' `value` byte-for-byte) — `trim_scale(round(x::numeric,
  --                            4))::text` reproduces that (20 -> "20", 5.5 -> "5.5", 2.1 -> "2.1"),
  --                            verified against Postgres directly, not assumed
  --      - discountPercent  <- "discountRate" (LINE-level; the INVOICE's own HEADER-level
  --                            "discountRate" is a different mechanism with no field of its own on the
  --                            new descriptor — see this migration's header)
  --      - $rowId           <- a freshly minted uuid, the exact identity `row-selection/
  --                            row-selection.ts`'s own `stampRowIds` would assign on the invoice's next
  --                            ordinary save — stamped here instead so a migrated invoice can be
  --                            credit-noted immediately, without first requiring an untouched re-save
  --                            just to acquire row identity it would otherwise silently lack
  --  - data.legacyNumber/legacyRawNumber/legacyStatus/legacyDiscountRate/legacyPayments: raw,
  --    undeclared facts preserved verbatim for audit/future-recovery — see this migration's own header
  INSERT INTO "DocumentInstance" ("id", "companyId", "typeId", "status", "data", "createdAt", "updatedAt")
  SELECT
    i."id",
    i."companyId",
    'invoice',
    CASE i."status"
      WHEN 'DRAFT' THEN 'draft'
      WHEN 'CANCELLED' THEN 'cancelled'
      WHEN 'REJECTED' THEN 'send_failed'
      WHEN 'REFUSED' THEN 'send_failed'
      WHEN 'TRANSMISSION_FAILED' THEN 'send_failed'
      ELSE 'sent' -- ISSUED, PAID, UNPAID, OVERDUE, SENT, ARCHIVED, PENDING_CLEARANCE, CLEARED, CORRECTED
    END,
    jsonb_strip_nulls(jsonb_build_object(
      'client', i."clientId",
      'origin', CASE WHEN i."quoteId" IS NOT NULL
                     THEN jsonb_build_object('entity', 'quote', 'id', i."quoteId")
                     ELSE NULL END,
      'issueDate', to_char(COALESCE(i."issuedAt", i."createdAt"), 'YYYY-MM-DD'),
      'dueDate', to_char(i."dueDate", 'YYYY-MM-DD'),
      'currency', i."currency"::text,
      'notes', i."notes",
      'clientReference', i."buyerReference",
      'lines', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'description', it."name",
          'quantity', it."quantity",
          'unit', it."unitOfMeasure",
          'unitPrice', it."unitPrice",
          'vatRate', trim_scale(round(it."vatRate"::numeric, 4))::text,
          'discountPercent', it."discountRate",
          '$rowId', gen_random_uuid()::text
        ) ORDER BY it."order")
        FROM "InvoiceItem" it WHERE it."invoiceId" = i."id"
      ), '[]'::jsonb),
      'legacyNumber', i."number",
      'legacyRawNumber', i."rawNumber",
      'legacyStatus', i."status"::text,
      'legacyDiscountRate', i."discountRate",
      'legacyPayments', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', p."id",
          'totalPaid', p."totalPaid",
          'paymentMethod', p."paymentMethod",
          'paymentDetails', p."paymentDetails",
          'paidAt', to_char(p."paidAt", 'YYYY-MM-DD HH24:MI:SS'),
          'items', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'invoiceItemId', pi."invoiceItemId",
              'amountPaid', pi."amountPaid"
            ))
            FROM "PaymentItem" pi WHERE pi."paymentId" = p."id"
          ), '[]'::jsonb)
        ) ORDER BY p."paidAt")
        FROM "Payment" p WHERE p."invoiceId" = i."id"
      ), '[]'::jsonb)
    )),
    i."createdAt",
    i."updatedAt"
  FROM "Invoice" i
  WHERE i."kind" = 'INVOICE'
  ON CONFLICT (id) DO NOTHING;

  FOR excluded_kind IN
    SELECT "kind"::text AS kind, count(*) AS n FROM "Invoice" WHERE "kind" <> 'INVOICE' GROUP BY "kind"
  LOOP
    RAISE NOTICE '[backfill] % "Invoice" row(s) of kind=% were NOT migrated to DocumentInstance (no '
      'lossless home in the new document model — see this migration''s own header).',
      excluded_kind.n, excluded_kind.kind;
  END LOOP;

  -- ## Quotes --------------------------------------------------------------------------------------
  --
  -- Same discipline as invoices, onto quote.descriptor.ts's own declared shape ('id': 'quote'). Every
  -- row travels — "Quote" carries no `kind` column, so there is no CREDIT_NOTE-style split to make.
  --  - status  <- QuoteStatus folded onto the FIVE new statuses: DRAFT->draft, SIGNED->signed,
  --              everything else (SENT/VIEWED/EXPIRED/REJECTED)->sent — none of the three has a
  --              dedicated new status (no "viewed", "expired" or "declined" lifecycle state exists on
  --              quote.descriptor.ts), and 'sent' is the closest honest bucket for "no longer a draft,
  --              did not end up signed". The underlying facts (`viewedAt`, `validUntil`, the decline
  --              itself) have no field to land in either — see legacy* below and this migration's own
  --              header.
  --  - data.client/currency/notes/clientReference/issueDate: identical reasoning to the invoice's own
  --    (above); "buyerReference" is this same PO/reference fact on the Quote's own table. Quote has NO
  --    "dueDate" column at all in the OLD model — the new descriptor's own `dueDate` is optional, so
  --    it is simply omitted, not invented.
  --  - data.lines: "QuoteItem" rows, same six-field mapping as InvoiceItem above (name/quantity/
  --    unitOfMeasure/unitPrice/vatRate/discountRate), plus the same freshly-minted "$rowId" — a quote
  --    line is never itself the target of a 'rowSelection' field today, but stamping it costs nothing
  --    and keeps both types' lines structurally identical.
  --  - legacyNumber/legacyRawNumber/legacyStatus/legacyDiscountRate/legacyValidUntil/legacySignedAt/
  --    legacySignedBy: verbatim, undeclared — see this migration's own header.
  INSERT INTO "DocumentInstance" ("id", "companyId", "typeId", "status", "data", "createdAt", "updatedAt")
  SELECT
    q."id",
    q."companyId",
    'quote',
    CASE q."status"
      WHEN 'DRAFT' THEN 'draft'
      WHEN 'SIGNED' THEN 'signed'
      ELSE 'sent' -- SENT, VIEWED, EXPIRED, REJECTED
    END,
    jsonb_strip_nulls(jsonb_build_object(
      'client', q."clientId",
      'issueDate', to_char(COALESCE(q."issuedAt", q."createdAt"), 'YYYY-MM-DD'),
      'currency', q."currency"::text,
      'notes', q."notes",
      'clientReference', q."buyerReference",
      'lines', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'description', qi."name",
          'quantity', qi."quantity",
          'unit', qi."unitOfMeasure",
          'unitPrice', qi."unitPrice",
          'vatRate', trim_scale(round(qi."vatRate"::numeric, 4))::text,
          'discountPercent', qi."discountRate",
          '$rowId', gen_random_uuid()::text
        ) ORDER BY qi."order")
        FROM "QuoteItem" qi WHERE qi."quoteId" = q."id"
      ), '[]'::jsonb),
      'legacyNumber', q."number",
      'legacyRawNumber', q."rawNumber",
      'legacyStatus', q."status"::text,
      'legacyDiscountRate', q."discountRate",
      'legacyValidUntil', to_char(q."validUntil", 'YYYY-MM-DD'),
      'legacySignedAt', to_char(q."signedAt", 'YYYY-MM-DD HH24:MI:SS'),
      'legacySignedBy', q."signedBy"
    )),
    q."createdAt",
    q."updatedAt"
  FROM "Quote" q
  ON CONFLICT (id) DO NOTHING;

  SELECT count(*) INTO recurring_count FROM "RecurringInvoice";
  IF recurring_count > 0 THEN
    RAISE NOTICE '[backfill] % "RecurringInvoice" row(s) were NOT migrated — no Prisma model for '
      'recurring generation exists any more (see this migration''s own header). Every invoice such a '
      'template already GENERATED is its own ordinary kind=INVOICE row and was migrated above.',
      recurring_count;
  END IF;

  SELECT count(*) INTO series_count FROM "NumberSeries";
  IF series_count > 0 THEN
    RAISE NOTICE '[backfill] % "NumberSeries" row(s) were NOT migrated — numbering is now the '
      'per-(company,typeId) "DocumentNumberSequence" counter (numbering/sequence.ts), a table that '
      'does not exist until a LATER migration and starts every counter fresh from zero.', series_count;
  END IF;
END $$;

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
