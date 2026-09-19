import { useApiMutation, useApiQuery } from "@/hooks/use-api-query"

import type { CreatedShareLink, ShareLinkSummary } from "@/components/documents/types"

const shareLinksKey = (typeId: string, documentId: string) => ["documents", typeId, documentId, "share-links"]

/** Metadata only — see `ShareLinkSummary`'s own comment: this list never carries a token or its
 *  hash, on the SAME "not re-consultable" guarantee the backend's own response shape already holds. */
export function useShareLinks(typeId: string, documentId: string, enabled: boolean) {
  return useApiQuery<ShareLinkSummary[]>(
    shareLinksKey(typeId, documentId),
    `/api/documents/${documentId}/share-links?typeId=${encodeURIComponent(typeId)}`,
    { enabled },
  )
}

interface CreateShareLinkVariables {
  typeId: string
  documentId: string
}

/**
 * Mints a new public link — the response's `token`/`path` are the ONLY time this API ever hands
 * them back (see documents.controller.ts's own `createShareLink`); the caller must show/copy them
 * immediately, from THIS mutation's own result, never by re-fetching.
 *
 * No static `invalidateKeys` here (unlike `useCreateDocumentSchedule`): the query key this action
 * should invalidate (`shareLinksKey(typeId, documentId)`) depends on the MUTATION's OWN variables,
 * which `useApiMutation`'s option only ever takes as a fixed array chosen once at hook-build time —
 * the dialog invalidates it by hand instead, right after a successful create/revoke (see
 * share-link-dialog.tsx).
 */
export function useCreateShareLink() {
  return useApiMutation<CreateShareLinkVariables, CreatedShareLink>(
    "POST",
    (vars) => `/api/documents/${vars.documentId}/share-link?typeId=${encodeURIComponent(vars.typeId)}`,
  )
}

interface RevokeShareLinkVariables {
  typeId: string
  documentId: string
  tokenId: string
}

/** Soft-revokes — the row stays in `list`, just with `revokedAt` set and `active: false`. */
export function useRevokeShareLink() {
  return useApiMutation<RevokeShareLinkVariables, { revoked: true }>(
    "DELETE",
    (vars) =>
      `/api/documents/${vars.documentId}/share-link/${vars.tokenId}?typeId=${encodeURIComponent(vars.typeId)}`,
  )
}

export { shareLinksKey }
