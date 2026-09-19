import { useApiMutation, useApiQuery } from "@/hooks/use-api-query"

import type { DocumentFieldDescriptor } from "@/components/documents/types"

// Mirrors backend/src/modules/documents/company-custom-fields/types.ts — wire shapes, deliberately
// duplicated rather than shared (see components/documents/types.ts's own header on why).

export type CompanyCustomFieldTarget = "CLIENT" | "DOCUMENT"

export interface CompanyCustomFieldOption {
  value: string
  label: string
}

export interface CompanyCustomFieldDefinition {
  id: string
  target: CompanyCustomFieldTarget
  documentTypeId: string | null
  key: string
  label: string
  kind: string
  options: CompanyCustomFieldOption[] | null
  required: boolean
  order: number
  archivedAt: string | null
}

export interface CreateCompanyCustomFieldInput {
  target: CompanyCustomFieldTarget
  documentTypeId?: string | null
  label: string
  kind: string
  options?: CompanyCustomFieldOption[]
  required?: boolean
  order?: number
}

export interface UpdateCompanyCustomFieldInput {
  label?: string
  options?: CompanyCustomFieldOption[]
  required?: boolean
  order?: number
}

const LIST_KEY = ["custom-fields"] as const

/** Every definition for this company (settings screen's own list) — includes archived rows so the
 *  screen can grey them out and offer "restore" (see the backend's own `list` endpoint header). */
export function useCompanyCustomFieldDefinitions() {
  return useApiQuery<CompanyCustomFieldDefinition[]>(LIST_KEY, "/api/custom-fields?includeArchived=true")
}

/**
 * ACTIVE definitions for one target, already shaped as `DocumentFieldDescriptor[]` — what the
 * document form/list (`target=DOCUMENT&typeId=...`) and the client form (`target=CLIENT`) both merge
 * into the generic field-renderer registry, with ZERO kind-specific code of their own (see the
 * backend's `GET /custom-fields/resolved` header). `typeId` is ignored server-side for `CLIENT`.
 */
export function useResolvedCompanyCustomFields(
  target: CompanyCustomFieldTarget,
  typeId?: string,
  options?: { includeArchived?: boolean },
) {
  const includeArchived = options?.includeArchived ?? false
  const params = new URLSearchParams({ target })
  if (typeId) params.set("typeId", typeId)
  if (includeArchived) params.set("includeArchived", "true")
  return useApiQuery<DocumentFieldDescriptor[]>(
    ["custom-fields", "resolved", target, typeId, includeArchived],
    `/api/custom-fields/resolved?${params.toString()}`,
    { enabled: target === "CLIENT" || !!typeId },
  )
}

export function useCreateCompanyCustomField() {
  return useApiMutation<CreateCompanyCustomFieldInput, CompanyCustomFieldDefinition>(
    "POST",
    () => "/api/custom-fields",
    { invalidateKeys: [LIST_KEY, ["custom-fields", "resolved"]] },
  )
}

interface UpdateVariables extends UpdateCompanyCustomFieldInput {
  id: string
}

export function useUpdateCompanyCustomField() {
  return useApiMutation<UpdateVariables, CompanyCustomFieldDefinition>(
    "PATCH",
    (vars) => `/api/custom-fields/${vars.id}`,
    { invalidateKeys: [LIST_KEY, ["custom-fields", "resolved"]] },
  )
}

export function useArchiveCompanyCustomField() {
  return useApiMutation<{ id: string }, CompanyCustomFieldDefinition>(
    "DELETE",
    (vars) => `/api/custom-fields/${vars.id}`,
    { invalidateKeys: [LIST_KEY, ["custom-fields", "resolved"]] },
  )
}

export function useRestoreCompanyCustomField() {
  return useApiMutation<{ id: string }, CompanyCustomFieldDefinition>(
    "POST",
    (vars) => `/api/custom-fields/${vars.id}/restore`,
    { invalidateKeys: [LIST_KEY, ["custom-fields", "resolved"]] },
  )
}
