import { useApiQuery } from "@/hooks/use-api-query"
import { queryKeys } from "@/lib/query-keys"
import type { Company } from "@/types"

export function useCompany() {
    return useApiQuery<Company>(
        queryKeys.company.info(),
        "/api/company/info",
    )
}
