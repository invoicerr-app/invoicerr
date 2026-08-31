import { useApiMutation, useApiQuery } from "@/hooks/use-api-query"

import type { DocumentSchedule } from "@/components/documents/types"

const SCHEDULES_KEY = ["document-schedules"] as const

/** Every recurrence for the active company — optionally narrowed to one document type. Same
 *  `typeId?` convention `useDocumentInstances` already holds. */
export function useDocumentSchedules(typeId?: string) {
  return useApiQuery<DocumentSchedule[]>(
    typeId ? [...SCHEDULES_KEY, typeId] : SCHEDULES_KEY,
    `/api/documents/schedules${typeId ? `?typeId=${encodeURIComponent(typeId)}` : ""}`,
  )
}

interface CreateDocumentScheduleVariables {
  typeId: string
  sourceDocumentId: string
  actionId: string
  cadence: string
  firstOccurrenceAt: string
  thenSend?: boolean
}

/** Creates a recurrence — "replay `actionId` on `sourceDocumentId`, on this cadence, starting at
 *  `firstOccurrenceAt`" (which may be in the past: it becomes due at the very next sweep pass). */
export function useCreateDocumentSchedule() {
  return useApiMutation<CreateDocumentScheduleVariables, DocumentSchedule>(
    "POST",
    "/api/documents/schedules",
    { invalidateKeys: [SCHEDULES_KEY] },
  )
}

interface SetDocumentScheduleEnabledVariables {
  id: string
  enabled: boolean
}

/** The screen's only write on an EXISTING recurrence: enable/disable. */
export function useSetDocumentScheduleEnabled() {
  return useApiMutation<SetDocumentScheduleEnabledVariables, DocumentSchedule>(
    "PATCH",
    (vars) => `/api/documents/schedules/${vars.id}`,
    { invalidateKeys: [SCHEDULES_KEY] },
  )
}

/** Deletes a recurrence permanently. */
export function useDeleteDocumentSchedule() {
  return useApiMutation<{ id: string }, { deleted: true }>(
    "DELETE",
    (vars) => `/api/documents/schedules/${vars.id}`,
    { invalidateKeys: [SCHEDULES_KEY] },
  )
}
