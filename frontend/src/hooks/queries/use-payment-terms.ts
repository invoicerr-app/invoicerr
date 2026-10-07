import { useApiMutation, useApiQuery } from "@/hooks/use-api-query"
import { queryKeys } from "@/lib/query-keys"
import type { Company, ResolvedPaymentTerms } from "@/types"

export function usePaymentTerms(enabled = true) {
  return useApiQuery<ResolvedPaymentTerms>(queryKeys.company.paymentTerms(), "/api/company/payment-terms", {
    enabled,
  })
}

export type SavePaymentTermsInput = Pick<
  Company,
  "quoteDueDays" | "quoteDueMode" | "invoiceDueDays" | "invoiceDueMode"
>

export function useSavePaymentTerms() {
  return useApiMutation<SavePaymentTermsInput, Company>("POST", "/api/company/info", {
    invalidateKeys: [queryKeys.company.paymentTerms(), queryKeys.company.info()],
  })
}
