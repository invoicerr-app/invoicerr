import { useApiQuery } from "@/hooks/use-api-query"
import { usePost } from "@/hooks/use-fetch"
import { queryKeys } from "@/lib/query-keys"
import type { ClientImportRowWire } from "@/lib/csv-import/client-rows"
import type { Client, ClientDuplicateMatch, ClientStatement } from "@/types"

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
 * A single client by id, scoped to the active company - used by the duplicate-detection wizard's own
 * "view existing client" link (`?view=<id>`, `pages/(app)/clients/index.tsx`), which may point at a
 * record NOT on the caller's currently loaded page of the paginated list (`useClients`). `enabled:
 * false` (no request at all) while `clientId` is unset, the same "nothing to fetch yet" shape
 * `useClientStatement` already holds.
 */
export function useClient(clientId: string | undefined) {
  return useApiQuery<Client>(queryKeys.clients.byId(clientId ?? ""), `/api/clients/${clientId}`, {
    enabled: !!clientId,
  })
}

/**
 * Client account statement - see the backend's
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

/**
 * Non-blocking duplicate detection for the client wizard - see the backend's own
 * `ClientsService.findDuplicates` header for the exact matching rule (email, or name+country
 * together, both case-insensitive). `enabled` is `false` (no request at all) whenever neither
 * criterion is usable yet, the same "nothing to check" state the backend itself treats as an empty
 * result rather than an error - this just avoids the round-trip for a value the server would answer
 * `[]` to anyway. `excludeId` is the client currently being edited, so it never flags itself.
 */
export function useClientDuplicates(params: {
  email?: string
  name?: string
  country?: string
  excludeId?: string
}) {
  const email = params.email?.trim()
  const name = params.name?.trim()
  const country = params.country?.trim()
  const enabled = !!email || !!(name && country)

  const search = new URLSearchParams()
  if (email) search.set("email", email)
  if (name) search.set("name", name)
  if (country) search.set("country", country)
  if (params.excludeId) search.set("excludeId", params.excludeId)

  return useApiQuery<ClientDuplicateMatch[]>(
    queryKeys.clients.duplicates(email, name, country, params.excludeId),
    `/api/clients/duplicates?${search.toString()}`,
    { enabled },
  )
}

export interface ClientImportDuplicateMatchWire {
  kind: "existing" | "file"
  matchedOn: "email" | "name_country"
  id?: string
  rowNumber?: number
  name: string
  contactEmail: string | null
}

export interface ClientImportRowResultWire {
  rowNumber: number
  status: "valid" | "duplicate" | "rejected"
  errors?: string[]
  duplicateOf?: ClientImportDuplicateMatchWire
}

export interface ClientImportPreviewResponse {
  rows: ClientImportRowResultWire[]
  summary: { total: number; willCreate: number; duplicates: number; rejected: number }
}

export interface ClientImportConfirmResponse {
  created: number
  duplicates: number
  rejected: number
}

/** `POST /clients/import/preview` - see `client-import.service.ts`'s own header on the backend for
 *  why this re-runs the server-side checks rather than trusting the browser's own zod pass. */
export function useImportClientsPreview() {
  return usePost<ClientImportPreviewResponse>("/api/clients/import/preview")
}

/** `POST /clients/import` - the confirm step. Also re-validates everything server-side and creates
 *  in one transaction; see the backend service for the all-or-nothing contract. */
export function useImportClientsConfirm() {
  return usePost<ClientImportConfirmResponse>("/api/clients/import")
}

export type { ClientImportRowWire }
