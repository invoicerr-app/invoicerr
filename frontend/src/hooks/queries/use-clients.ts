import { useApiQuery } from "@/hooks/use-api-query"
import { queryKeys } from "@/lib/query-keys"
import type { Client } from "@/types"

export interface ClientsListResponse {
    pageCount: number
    clients: Client[]
}

export function useClients(page: number) {
    return useApiQuery<ClientsListResponse>(
        queryKeys.clients.list(page),
        `/api/clients?page=${page}`,
    )
}

export function useClientSearch(query: string) {
    return useApiQuery<Client[]>(
        queryKeys.clients.search(query),
        `/api/clients/search?query=${encodeURIComponent(query)}`,
    )
}
