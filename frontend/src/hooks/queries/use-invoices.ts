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

export function useUnlinkedDeposits(clientId: string | null | undefined) {
    return useApiQuery<Invoice[]>(
        ["invoices", "unlinkedDeposits", clientId ?? ""],
        `/api/invoices/deposits?clientId=${encodeURIComponent(clientId ?? "")}`,
        {
            enabled: !!clientId,
        },
    )
}
