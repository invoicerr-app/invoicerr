import { useQueries } from "@tanstack/react-query"

import { apiFetch, useApiMutation, useApiQuery } from "@/hooks/use-api-query"

import type {
  ActionResult,
  DocumentInstance,
  DocumentTypeDescriptor,
  DocumentTypeSummary,
  EntityReferenceOption,
} from "@/components/documents/types"

/** Every registered document type — a front-end nav renders this without knowing any type by name. */
export function useDocumentTypesList() {
  return useApiQuery<DocumentTypeSummary[]>(["document-types"], "/api/documents/types")
}

/** The full descriptor a form is rendered from. */
export function useDocumentType(typeId: string | undefined) {
  return useApiQuery<DocumentTypeDescriptor>(["document-types", typeId], `/api/documents/types/${typeId}`, {
    enabled: !!typeId,
  })
}

export function useDocumentInstances(typeId: string | undefined) {
  return useApiQuery<DocumentInstance[]>(["documents", typeId], `/api/documents?typeId=${typeId}`, {
    enabled: !!typeId,
  })
}

export function useDocumentInstance(typeId: string | undefined, id: string | undefined) {
  return useApiQuery<DocumentInstance>(["documents", typeId, id], `/api/documents/${id}?typeId=${typeId}`, {
    enabled: !!typeId && !!id,
  })
}

interface RunActionVariables {
  typeId: string
  actionId: string
  documentId?: string
  data: Record<string, unknown>
  /** The action's OWN params (see DocumentActionDescriptor.params) — a separate namespace from `data`. */
  params?: Record<string, unknown>
}

/** Runs one declared action of one document type (e.g. "save-draft"), native or attached by a third
 *  party — this hook never knows which. A 501 means the action is declared on the descriptor but has
 *  no implementation registered yet — see ApiError.status. */
export function useRunDocumentAction() {
  return useApiMutation<RunActionVariables, ActionResult>(
    "POST",
    (vars) => `/api/documents/types/${vars.typeId}/actions/${vars.actionId}`,
    { invalidateKeys: [["documents"]] },
  )
}

interface ActionParamsDefaultsVariables {
  typeId: string
  actionId: string
  documentId?: string
  data: Record<string, unknown>
}

/** Optional pre-fill for an action's params dialog (e.g. "send" pre-filling the recipient from the
 *  document's client) — resolves to `{}` when the action has no defaults resolver, never an error. A
 *  mutation rather than a query: it depends on the form's current, possibly-unsaved values, fetched
 *  once when the params dialog opens rather than kept live. */
export function useResolveActionParamsDefaults() {
  return useApiMutation<ActionParamsDefaultsVariables, Record<string, unknown>>(
    "POST",
    (vars) => `/api/documents/types/${vars.typeId}/actions/${vars.actionId}/params/defaults`,
  )
}

/** Generic search behind a 'reference' field, regardless of which entity it targets. */
export function useReferenceSearch(entity: string | undefined, query: string) {
  return useApiQuery<EntityReferenceOption[]>(
    ["document-references", entity, "search", query],
    `/api/documents/references/${entity}/search?q=${encodeURIComponent(query)}`,
    { enabled: !!entity },
  )
}

/** Resolves a single already-set reference value to its display label. */
export function useReferenceResolve(entity: string | undefined, id: string | undefined) {
  return useApiQuery<EntityReferenceOption | null>(
    ["document-references", entity, id],
    `/api/documents/references/${entity}/${id}`,
    { enabled: !!entity && !!id },
  )
}

/** One search result from a MULTI-target 'reference' field's fan-out search, tagged with which
 *  entity it came from — this is what lets the picker show "of which type" each result is. */
export interface EntityReferenceSearchHit extends EntityReferenceOption {
  entity: string
}

/**
 * Fans a single search query out to EVERY entity a multi-target 'reference' field allows (e.g.
 * `entities: ["quote", "invoice"]`), through the exact same generic per-entity search endpoint a
 * single-target field already uses — no backend endpoint changes needed for "multiple targets" at
 * all, only calling the existing one more than once and merging. `useQueries` (not a fixed number of
 * `useReferenceSearch` calls) is what lets `entities` be a runtime-provided list without breaking the
 * rules of hooks.
 */
export function useMultiEntityReferenceSearch(entities: string[], query: string) {
  return useQueries({
    queries: entities.map((entity) => ({
      queryKey: ["document-references", entity, "search", query],
      queryFn: () =>
        apiFetch<EntityReferenceOption[]>(
          `/api/documents/references/${entity}/search?q=${encodeURIComponent(query)}`,
        ),
    })),
    combine: (results) => ({
      data: results.flatMap((result, index) =>
        (result.data ?? []).map((option) => ({ ...option, entity: entities[index] })),
      ) as EntityReferenceSearchHit[],
      isLoading: results.some((result) => result.isLoading),
    }),
  })
}

/** The registered document transports (documents/transports/transport-registry.ts) — what a
 *  company's settings screen offers for `invoiceTransportId`. Never scoped by country. */
export function useDocumentTransports() {
  return useApiQuery<DocumentTypeSummary[]>(["document-transports"], "/api/documents/transports")
}

/** One row a 'rowSelection' field may currently offer — the source row's own field values, exactly
 *  as stored (minus the internal identity key), keyed by its stable id. */
export interface SelectableRow {
  id: string
  data: Record<string, unknown>
}

export interface SelectableRowsResult {
  sourceTypeId: string
  sourceArrayField: string
  rows: SelectableRow[]
}

/**
 * What a 'rowSelection' field on document type `typeId`, field `fieldKey`, may currently offer, given
 * the LIVE value of its sourceField sibling (`sourceId` — read off the form, not necessarily saved
 * yet). Disabled while `sourceId` is unset: the backend already degrades to an empty list in that
 * case (see row-selection/resolve-row-selection.ts's listSourceRows), but not even asking avoids a
 * request that can only ever come back empty.
 */
export function useSelectableRows(
  typeId: string | undefined,
  fieldKey: string | undefined,
  sourceId: string | undefined,
) {
  return useApiQuery<SelectableRowsResult>(
    ["document-row-selection", typeId, fieldKey, sourceId],
    `/api/documents/types/${typeId}/fields/${fieldKey}/rows?sourceId=${encodeURIComponent(sourceId ?? "")}`,
    { enabled: !!typeId && !!fieldKey && !!sourceId },
  )
}
