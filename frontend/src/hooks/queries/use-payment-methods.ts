import { useApiMutation, useApiQuery } from "@/hooks/use-api-query"
import { queryKeys } from "@/lib/query-keys"
import type { PaymentMethodConfig } from "@/types/payment-method"

/**
 * A company's own accepted payment methods — its own top-level screen (payment-methods/index.tsx),
 * not a settings tab. Mirrors the backend's `payment-methods/` module: `GET` always returns the FULL
 * registered list (configured or not); `PATCH` updates one method's own `enabled`/`config`.
 */

export function usePaymentMethods() {
  return useApiQuery<PaymentMethodConfig[]>(queryKeys.paymentMethods.list(), "/api/payment-methods")
}

export interface UpdatePaymentMethodVariables {
  methodId: string
  enabled?: boolean
  config?: Record<string, unknown>
}

/** Invalidates the list so the card immediately reflects the saved `enabled`/`config` — the same
 *  "one mutation, one invalidation" convention every other settings-shaped mutation in this app
 *  already follows (e.g. useImportBankStatement). */
export function useUpdatePaymentMethod() {
  return useApiMutation<UpdatePaymentMethodVariables, PaymentMethodConfig>(
    "PATCH",
    ({ methodId }) => `/api/payment-methods/${methodId}`,
    { invalidateKeys: [queryKeys.paymentMethods.list()] },
  )
}
