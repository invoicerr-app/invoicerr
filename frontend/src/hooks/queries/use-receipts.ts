import { useApiQuery } from "@/hooks/use-api-query"
import { queryKeys } from "@/lib/query-keys"
import type { Receipt } from "@/types"

export interface ReceiptsListResponse {
    pageCount: number
    receipts: Receipt[]
}

export function useReceipts(page: number) {
    return useApiQuery<ReceiptsListResponse>(
        queryKeys.receipts.list(page),
        `/api/receipts?page=${page}`,
    )
}
