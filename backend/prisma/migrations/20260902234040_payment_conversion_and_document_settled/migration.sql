/*
  TODO_PRODUIT.md T3 (2026-09-03) — closes the TODO_ISSUES.md entry "les taux existent, mais
  paiements et avoirs ne convertissent toujours pas", per that entry's own recorded WHY: a lettrage
  needs "un taux PAR OPÉRATION (saisi au moment du paiement, stocké sur lui), pas le taux ambiant de
  la société" — exactly what `documentAmountMinor`/`conversionRate`/`conversionRateAsOf`/
  `conversionSource` below are (see `DocumentPayment`'s own schema.prisma comment for the full
  reasoning, and `settlement/convert-payment.ts` for the arithmetic that fills them in).

  `documentAmountMinor` is NOT NULL with no default — every `DocumentPayment` row written BEFORE
  this task exists only because "record-payment" refused any currency but the document's own (see
  invoice-actions.ts's pre-T3 guard), so for every one of them `documentAmountMinor` is trivially
  `amountMinor` itself (no conversion ever applied). Backfilled explicitly below, in its own step,
  rather than a bare `ADD COLUMN ... NOT NULL` — which Postgres refuses outright the moment this
  table holds a single row (a real, non-empty self-hosted install almost certainly does by the time
  it upgrades to this migration) — the same "never a migration that only works on an empty table"
  discipline `sync-schema.ts`'s own callers already hold for a legacy self-hosted DB.

  `DOCUMENT_SETTLED` joins the `WebhookEvent` enum as a plain ADD VALUE — unlike
  20260903000000_generic_document_webhook_events (which had to REMOVE 51 values, and Postgres has no
  `DROP VALUE`, hence that migration's own type-rebuild dance), adding one is directly supported and
  needs no such reconstruction.
*/

-- AlterEnum
ALTER TYPE "WebhookEvent" ADD VALUE 'DOCUMENT_SETTLED';

-- AlterTable: add every new column NULLABLE first — see this file's own header on why
-- `documentAmountMinor` cannot go straight to NOT NULL on a table that may already hold rows.
ALTER TABLE "DocumentPayment" ADD COLUMN     "conversionRate" DECIMAL(65,30),
ADD COLUMN     "conversionRateAsOf" TIMESTAMP(3),
ADD COLUMN     "conversionSource" TEXT,
ADD COLUMN     "documentAmountMinor" INTEGER;

-- Backfill: every pre-existing row was, by construction, paid in the document's own currency (see
-- this file's own header) — its settlement-relevant figure is exactly its own `amountMinor`, and it
-- was never converted, so the three `conversion*` columns rightly stay NULL for it.
UPDATE "DocumentPayment" SET "documentAmountMinor" = "amountMinor" WHERE "documentAmountMinor" IS NULL;

-- Now that every existing row (and any row a concurrent write could have added) is backfilled, the
-- column can safely become NOT NULL for every write from here on.
ALTER TABLE "DocumentPayment" ALTER COLUMN "documentAmountMinor" SET NOT NULL;
