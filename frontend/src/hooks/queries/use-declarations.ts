import { useApiQuery } from "@/hooks/use-api-query"
import { queryKeys } from "@/lib/query-keys"

/**
 * One row from `GET /api/documents/declarations` — mirrors the backend's `DeclarationListEntry`
 * (documents/reporting/list-declarations.ts). A DECLARATION, never an ordinary post-deposit
 * conformity poll event (pdp/ksef/chorus-pro — those stay on the per-document
 * `useDocumentAuthorityEvents`): see that backend file's own header for how the two are told apart.
 * `statusCode`/`statusText`/`reason` are shown VERBATIM, never translated by this app's own copy when
 * unrecognized — same convention `DocumentAuthorityEvent` already holds on the per-document timeline.
 * `countryCode` is absent (never null) only in the unreachable case where a historical event's own
 * `providerId` was later removed from every country's `reporting/data/*.json` file.
 */
export interface DeclarationEntry {
  id: string
  documentId: string
  typeId: string
  displayNumber: string | null
  providerId: string
  countryCode?: string
  statusCode: string
  statusText: string | null
  reason: string | null
  observedAt: string
}

/** Mirrors the backend's `ListDeclarationsResult`. `hasObligation` is absent (never a guessed
 *  `false`) only when the active company's own country cannot be resolved at all — see the backend's
 *  own header on why that stays distinct from "resolved, but genuinely no obligation". */
export interface DeclarationsListResponse {
  declarations: DeclarationEntry[]
  pageCount: number
  statusCodes: string[]
  hasObligation?: boolean
}

/**
 * The company-wide "Declarations" screen's own backing query — every declarative-reporting event
 * journaled for the active company, across every document, most recent first. `status`, when given,
 * narrows to an EXACT `statusCode` match (see the backend's own `listDeclarations` header on why a
 * fuzzy match was never worth building for this small, provider-defined vocabulary).
 */
export function useDeclarations(page: number, status?: string) {
  const query = new URLSearchParams({ page: String(page) })
  if (status) query.set("status", status)
  return useApiQuery<DeclarationsListResponse>(
    queryKeys.declarations.list(page, status),
    `/api/documents/declarations?${query.toString()}`,
  )
}
