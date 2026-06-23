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
