import { useApiMutation, useApiQuery } from "@/hooks/use-api-query"

import type { CreatedPortalAccess, PortalAccessSummary } from "@/types"

/**
 * The STAFF-facing half of the client portal — invite a client, list/revoke their access. Ordinary
 * session-authenticated calls (`useApiQuery`/`useApiMutation`, the SAME cookie every other screen in
 * the app already uses), the exact "invite CRUD" shape `use-share-links.ts` already holds for a
 * document link.
 */
const portalAccessKey = (clientId: string) => ["clients", clientId, "portal-access"]

export function usePortalAccess(clientId: string, enabled: boolean) {
  return useApiQuery<PortalAccessSummary[]>(
    portalAccessKey(clientId),
    `/api/clients/${clientId}/portal-access`,
    { enabled },
  )
}

/** Mints a fresh invite — the response's `token`/`path` are the ONLY time this API ever hands them
 *  back (same "shown once" contract `useCreateShareLink` already documents). */
export function useCreatePortalAccess() {
  return useApiMutation<{ clientId: string }, CreatedPortalAccess>(
    "POST",
    (vars) => `/api/clients/${vars.clientId}/portal-access`,
  )
}

export function useRevokePortalAccess() {
  return useApiMutation<{ clientId: string; tokenId: string }, { revoked: true }>(
    "DELETE",
    (vars) => `/api/clients/${vars.clientId}/portal-access/${vars.tokenId}`,
  )
}

/** "Cut off portal access entirely" — revokes every active invite for the client in one call, e.g.
 *  after a leaked link, rather than revoking each row one by one. */
export function useRevokeAllPortalAccess() {
  return useApiMutation<{ clientId: string }, { revoked: true }>(
    "DELETE",
    (vars) => `/api/clients/${vars.clientId}/portal-access`,
  )
}

export { portalAccessKey }
