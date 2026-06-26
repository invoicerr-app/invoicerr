import { useApiQuery } from "@/hooks/use-api-query"
import { queryKeys } from "@/lib/query-keys"
import type { Payment } from "@/types"

export interface PaymentsListResponse {
    pageCount: number
    payments: Payment[]
}

export function usePayments(page: number) {
    return useApiQuery<PaymentsListResponse>(
        queryKeys.payments.list(page),
        `/api/payments?page=${page}`,
    )
}

export interface PaymentsTableFilters {
    invoiceId?: string
    clientId?: string
    year?: number
    month?: number
    sort: "asc" | "desc"
}

export function usePaymentsTable(filters: PaymentsTableFilters) {
    const params = new URLSearchParams()
    if (filters.invoiceId) params.set("invoiceId", filters.invoiceId)
    if (filters.clientId) params.set("clientId", filters.clientId)
    if (filters.year !== undefined) params.set("year", String(filters.year))
    if (filters.month !== undefined) params.set("month", String(filters.month))
    params.set("sort", filters.sort)

    return useApiQuery<Payment[]>(
        queryKeys.payments.table(filters),
        `/api/payments/table?${params.toString()}`,
    )
}
