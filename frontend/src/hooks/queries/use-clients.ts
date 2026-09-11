import { useApiQuery } from "@/hooks/use-api-query"
import { queryKeys } from "@/lib/query-keys"
import type { Client, ClientStatement } from "@/types"

export interface ClientsListResponse {
  pageCount: number
  clients: Client[]
}

export function useClients(page: number) {
  return useApiQuery<ClientsListResponse>(queryKeys.clients.list(page), `/api/clients?page=${page}`)
}

export function useClientSearch(query: string) {
  return useApiQuery<Client[]>(
    queryKeys.clients.search(query),
    `/api/clients/search?query=${encodeURIComponent(query)}`,
  )
}

/**
 * Client account statement ("relevé de compte client") — see the backend's
 * `ClientsService.getStatement`. Keyed under `queryKeys.clients.statement`, its own key (not nested
 * under `["clients", "list", ...]`) since it isn't paginated and has nothing to do with the list's own
 * cache entries.
 */
export function useClientStatement(clientId: string | undefined) {
  return useApiQuery<ClientStatement>(
    queryKeys.clients.statement(clientId ?? ""),
    `/api/clients/${clientId}/statement`,
    { enabled: !!clientId },
  )
}
