import { useApiQuery } from "@/hooks/use-api-query"
import { queryKeys } from "@/lib/query-keys"
import type { Article } from "@/types"

export function useArticles() {
    return useApiQuery<Article[]>(
        queryKeys.articles.list(),
        "/api/articles",
    )
}
