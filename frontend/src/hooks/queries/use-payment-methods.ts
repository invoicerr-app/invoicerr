import { useApiQuery } from "@/hooks/use-api-query"
import { queryKeys } from "@/lib/query-keys"
import type { PaymentMethod } from "@/types"

export function usePaymentMethods() {
    return useApiQuery<PaymentMethod[]>(
        queryKeys.paymentMethods.list(),
        "/api/payment-methods",
    )
}
