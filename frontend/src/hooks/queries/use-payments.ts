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
