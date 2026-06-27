import { useApiQuery } from "@/hooks/use-api-query"
import { queryKeys } from "@/lib/query-keys"
import type { Invoice } from "@/types"

export interface InvoicesListResponse {
    pageCount: number
    invoices: Invoice[]
}

export function useInvoices(page: number) {
    return useApiQuery<InvoicesListResponse>(
        queryKeys.invoices.list(page),
        `/api/invoices?page=${page}`,
    )
}

export function useInvoiceSearch(query: string) {
    return useApiQuery<Invoice[]>(
        queryKeys.invoices.search(query),
        `/api/invoices/search?query=${encodeURIComponent(query)}`,
        {
            select: (data) => (Array.isArray(data) ? data : (data as any).invoices ?? []),
        },
    )
}

export interface InvoicesTableFilters {
    clientId?: string
    year?: number
    month?: number
    sort: "asc" | "desc"
}

export function useInvoicesTable(filters: InvoicesTableFilters) {
    const params = new URLSearchParams()
    if (filters.clientId) params.set("clientId", filters.clientId)
    if (filters.year !== undefined) params.set("year", String(filters.year))
    if (filters.month !== undefined) params.set("month", String(filters.month))
    params.set("sort", filters.sort)

    return useApiQuery<Invoice[]>(
        queryKeys.invoices.table(filters),
        `/api/invoices/table?${params.toString()}`,
    )
}
