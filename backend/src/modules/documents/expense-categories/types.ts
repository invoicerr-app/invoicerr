/**
 * Wire shapes for the per-company expense category CRUD — see `persistence.ts`'s own header for the
 * full "why this exists" (product decision 2026-09-15, superseding `expense.descriptor.ts`'s original
 * fixed-list design). Deliberately narrower than `company-custom-fields/types.ts`'s own
 * `CompanyCustomField*` shapes: an expense category has no `target`/`documentTypeId`/`kind`/`options`/
 * `required`/`order` of its own — it is always exactly one thing, a (key, label) pair scoped to a
 * document type ("expense") that has no other consumer.
 */

/** One category, as returned to the settings screen and to any other caller. `key` is shown (it is
 *  what a scripted export/import would need), never editable — see `UpdateExpenseCategoryInput`'s own
 *  header. */
export interface ExpenseCategoryView {
  id: string;
  key: string;
  label: string;
  archivedAt: string | null;
}

/** The request body for `POST /api/documents/expense-categories`. `key` is deliberately ABSENT: it is
 *  derived from `label` at creation time (`persistence.ts#slugify`) and never accepted from the
 *  caller — see `schema.prisma`'s own `ExpenseCategory.key` header for why it must be assigned once
 *  and never renamed. */
export interface CreateExpenseCategoryInput {
  label: string;
}

/** The request body for `PUT /api/documents/expense-categories/:id` — `label` is the only mutable
 *  fact a category has. */
export interface UpdateExpenseCategoryInput {
  label: string;
}

/** A raw DB row shape wide enough for `toView` below — matches the Prisma model, kept separate from
 *  `ExpenseCategoryView` (whose `archivedAt` is already ISO-stringified). */
export interface ExpenseCategoryRecord {
  id: string;
  companyId: string;
  key: string;
  label: string;
  archivedAt: Date | null;
}

export function toView(record: ExpenseCategoryRecord): ExpenseCategoryView {
  return {
    id: record.id,
    key: record.key,
    label: record.label,
    archivedAt: record.archivedAt ? record.archivedAt.toISOString() : null,
  };
}
