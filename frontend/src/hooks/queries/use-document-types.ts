import { useApiMutation, useApiQuery } from "@/hooks/use-api-query"

import type {
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
}

/** Runs one declared action of one document type (e.g. "save-draft"). A 501 means the action is
 *  declared on the descriptor but has no implementation registered yet — see ApiError.status. */
export function useRunDocumentAction() {
  return useApiMutation<RunActionVariables, DocumentInstance>(
    "POST",
    (vars) => `/api/documents/types/${vars.typeId}/actions/${vars.actionId}`,
    { invalidateKeys: [["documents"]] },
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
