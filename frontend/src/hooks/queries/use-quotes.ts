import { useApiQuery } from "@/hooks/use-api-query"
import { queryKeys } from "@/lib/query-keys"
import type { Quote } from "@/types"

export interface QuotesListResponse {
    pageCount: number
    quotes: Quote[]
}

export function useQuotes(page: number) {
    return useApiQuery<QuotesListResponse>(
        queryKeys.quotes.list(page),
        `/api/quotes?page=${page}`,
    )
}

export function useQuoteSearch(query: string) {
    return useApiQuery<Quote[]>(
        queryKeys.quotes.search(query),
        `/api/quotes/search?query=${encodeURIComponent(query)}`,
    )
}

export interface QuotesTableFilters {
    clientId?: string
    year?: number
    month?: number
    sort: "asc" | "desc"
}

export function useQuotesTable(filters: QuotesTableFilters) {
    const params = new URLSearchParams()
    if (filters.clientId) params.set("clientId", filters.clientId)
    if (filters.year !== undefined) params.set("year", String(filters.year))
    if (filters.month !== undefined) params.set("month", String(filters.month))
    params.set("sort", filters.sort)

    return useApiQuery<Quote[]>(
        queryKeys.quotes.table(filters),
        `/api/quotes/table?${params.toString()}`,
    )
}
