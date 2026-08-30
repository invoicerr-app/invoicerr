-- Migrates the old bespoke "Expense" table into the generic document-descriptor model, as
-- DocumentInstance rows with typeId = 'expense' (see
-- backend/src/modules/documents/descriptors/expense.descriptor.ts). This is a DATA migration, not
-- only a schema one: every existing expense keeps its id, its company, and its own field values —
-- reshaped into the descriptor's flat JSON `data` shape (description/amount/currency/date/notes),
-- and its original `createdAt`/`updatedAt` timestamps are preserved rather than reset to "now".
--
-- Every migrated row lands with status = 'draft': the expense document type has no other status a
-- record could plausibly have moved to (see expense.descriptor.ts's own actions — "save-draft" and
-- "delete" only), so this is not a downgrade of anything the old table used to track (it tracked no
-- status at all).
INSERT INTO "DocumentInstance" ("id", "companyId", "typeId", "status", "data", "createdAt", "updatedAt")
SELECT
  "id",
  "companyId",
  'expense',
  'draft',
  jsonb_build_object(
    'description', "description",
    'amount', "amount",
    'currency', "currency"::text,
    'date', to_char("date", 'YYYY-MM-DD'),
    'notes', "notes"
  ),
  "createdAt",
  "updatedAt"
FROM "Expense";

/*
  Warnings:

  - You are about to drop the `Expense` table. Safe: every row was just copied above into
    `DocumentInstance` (typeId = 'expense') by the INSERT ... SELECT this migration runs first.

*/
-- DropForeignKey
ALTER TABLE "Expense" DROP CONSTRAINT "Expense_companyId_fkey";

-- DropTable
DROP TABLE "Expense";
