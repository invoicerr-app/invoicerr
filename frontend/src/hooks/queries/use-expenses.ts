import { useApiMutation, useApiQuery } from "@/hooks/use-api-query"

import type { Expense } from "@/types"
import { queryKeys } from "@/lib/query-keys"

export function useExpenses() {
    return useApiQuery<Expense[]>(
        queryKeys.expenses.list(),
        "/api/expenses",
    )
}

export interface ExpenseInput {
    description: string
    amount: number
    currency: string
    date: Date
    notes?: string
}

export function useCreateExpense() {
    return useApiMutation<ExpenseInput, Expense>("POST", "/api/expenses", {
        invalidateKeys: [queryKeys.expenses.list()],
    })
}

export function useUpdateExpense() {
    return useApiMutation<ExpenseInput & { id: string }, Expense>(
        "PATCH",
        (variables) => `/api/expenses/${variables.id}`,
        { invalidateKeys: [queryKeys.expenses.list()] },
    )
}

export function useDeleteExpense() {
    return useApiMutation<string, void>(
        "DELETE",
        (id) => `/api/expenses/${id}`,
        { invalidateKeys: [queryKeys.expenses.list()] },
    )
}
