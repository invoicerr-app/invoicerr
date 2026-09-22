import { useApiMutation, useApiQuery } from "@/hooks/use-api-query"

// Mirrors backend/src/modules/documents/expense-categories/types.ts — wire shapes, deliberately
// duplicated rather than shared (same convention `use-company-custom-fields.ts`'s own header
// documents for its own mirrored shapes).

export interface ExpenseCategory {
  id: string
  key: string
  label: string
  archivedAt: string | null
}

export interface CreateExpenseCategoryInput {
  label: string
}

export interface UpdateExpenseCategoryInput {
  label: string
}

const LIST_KEY = ["expense-categories"] as const

/** Every category for this company (settings screen's own list) — includes archived rows so the
 *  screen can grey them out (see the backend's own `list` endpoint header). The expense FORM never
 *  calls this hook: it reads its options from `describeTypeForCompany`
 *  (`useDocumentTypeDescriptor`/equivalent), which already composes this same data server-side. */
export function useExpenseCategories() {
  return useApiQuery<ExpenseCategory[]>(LIST_KEY, "/api/documents/expense-categories?includeArchived=true")
}

export function useCreateExpenseCategory() {
  return useApiMutation<CreateExpenseCategoryInput, ExpenseCategory>(
    "POST",
    () => "/api/documents/expense-categories",
    { invalidateKeys: [LIST_KEY] },
  )
}

interface UpdateVariables extends UpdateExpenseCategoryInput {
  id: string
}

export function useUpdateExpenseCategory() {
  return useApiMutation<UpdateVariables, ExpenseCategory>(
    "PUT",
    (vars) => `/api/documents/expense-categories/${vars.id}`,
    { invalidateKeys: [LIST_KEY] },
  )
}

export function useArchiveExpenseCategory() {
  return useApiMutation<{ id: string }, ExpenseCategory>(
    "DELETE",
    (vars) => `/api/documents/expense-categories/${vars.id}`,
    { invalidateKeys: [LIST_KEY] },
  )
}
