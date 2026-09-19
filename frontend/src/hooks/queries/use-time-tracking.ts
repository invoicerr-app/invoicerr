import { useApiMutation, useApiQuery } from "@/hooks/use-api-query"
import { queryKeys } from "@/lib/query-keys"
import type { GenerateInvoiceFromTimeEntriesResult, Project, TimeEntry } from "@/types"

export interface ProjectsFilters {
  clientId?: string
  includeArchived?: boolean
}

function projectsUrl(filters: ProjectsFilters): string {
  const params = new URLSearchParams()
  if (filters.clientId) params.set("clientId", filters.clientId)
  if (filters.includeArchived) params.set("includeArchived", "true")
  const query = params.toString()
  return `/api/projects${query ? `?${query}` : ""}`
}

export function useProjects(filters: ProjectsFilters = {}) {
  return useApiQuery<Project[]>(queryKeys.projects.list(filters), projectsUrl(filters))
}

export interface CreateProjectVariables {
  clientId: string
  name: string
  description?: string
  hourlyRate?: number | null
}

export function useCreateProject() {
  return useApiMutation<CreateProjectVariables, Project>("POST", "/api/projects", {
    invalidateKeys: [["projects", "list"]],
  })
}

export interface EditProjectVariables {
  id: string
  name?: string
  description?: string | null
  hourlyRate?: number | null
  isArchived?: boolean
}

export function useUpdateProject() {
  return useApiMutation<EditProjectVariables, Project>("PATCH", (vars) => `/api/projects/${vars.id}`, {
    invalidateKeys: [["projects", "list"]],
  })
}

export interface TimeEntriesFilters {
  projectId?: string
  clientId?: string
  unbilledOnly?: boolean
}

function timeEntriesUrl(filters: TimeEntriesFilters): string {
  const params = new URLSearchParams()
  if (filters.projectId) params.set("projectId", filters.projectId)
  if (filters.clientId) params.set("clientId", filters.clientId)
  if (filters.unbilledOnly) params.set("unbilledOnly", "true")
  const query = params.toString()
  return `/api/time-entries${query ? `?${query}` : ""}`
}

export function useTimeEntries(filters: TimeEntriesFilters = {}) {
  return useApiQuery<TimeEntry[]>(queryKeys.timeEntries.list(filters), timeEntriesUrl(filters))
}

export interface CreateTimeEntryVariables {
  projectId: string
  date: string
  durationMinutes: number
  description?: string
  billable?: boolean
  hourlyRate?: number | null
}

export function useCreateTimeEntry() {
  return useApiMutation<CreateTimeEntryVariables, TimeEntry>("POST", "/api/time-entries", {
    invalidateKeys: [["timeEntries", "list"]],
  })
}

export interface EditTimeEntryVariables {
  id: string
  date?: string
  durationMinutes?: number
  description?: string | null
  billable?: boolean
  hourlyRate?: number | null
}

export function useUpdateTimeEntry() {
  return useApiMutation<EditTimeEntryVariables, TimeEntry>(
    "PATCH",
    (vars) => `/api/time-entries/${vars.id}`,
    { invalidateKeys: [["timeEntries", "list"]] },
  )
}

export function useDeleteTimeEntry() {
  return useApiMutation<{ id: string }, { id: string }>("DELETE", (vars) => `/api/time-entries/${vars.id}`, {
    invalidateKeys: [["timeEntries", "list"]],
  })
}

export interface GenerateInvoiceVariables {
  clientId: string
  entryIds: string[]
}

/**
 * Bills the selected entries into ONE new draft invoice — see the backend's
 * `TimeEntriesService.billToInvoice` for the atomic double-billing guard this call rests on.
 * Invalidates the time entries list (the billed ones now carry an `invoiceId` and drop off the
 * "unbilled" picker) AND `["documents"]` (the generic document list — see use-document-types.ts's own
 * `useRunDocumentAction`, which sweeps the same key), so the new draft shows up on `/documents/invoice`
 * without a manual refresh.
 */
export function useGenerateInvoiceFromTimeEntries() {
  return useApiMutation<GenerateInvoiceVariables, GenerateInvoiceFromTimeEntriesResult>(
    "POST",
    "/api/time-entries/generate-invoice",
    { invalidateKeys: [["timeEntries", "list"], ["documents"]] },
  )
}
