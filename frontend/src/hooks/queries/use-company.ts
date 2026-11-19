import { useApiQuery } from "@/hooks/use-api-query"
import { currencies } from "@/lib/constants/currencies"
import { queryKeys } from "@/lib/query-keys"
import type { Company } from "@/types"

export function useCompany() {
  return useApiQuery<Company>(queryKeys.company.info(), "/api/company/info")
}

/** The active company's currency symbol; `fallback` while the company (or its currency) is unknown. */
export function useCompanyCurrencySymbol(fallback?: string): string | undefined {
  const { data: company } = useCompany()
  return company?.currency ? currencies[company.currency]?.symbol : fallback
}
