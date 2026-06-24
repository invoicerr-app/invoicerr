import { useApiQuery } from "@/hooks/use-api-query"
import { queryKeys } from "@/lib/query-keys"
import type { RecurringInvoice } from "@/types"

export interface RecurringInvoicesListResponse {
    pageCount: number
    recurringInvoices: RecurringInvoice[]
}

export function useRecurringInvoices(page: number = 1) {
    return useApiQuery<RecurringInvoicesListResponse>(
        queryKeys.recurringInvoices.list(page),
        `/api/recurring-invoices?page=${page}`,
    )
}
