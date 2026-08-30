import { useApiQuery } from "@/hooks/use-api-query"

import type { Widget } from "@/components/widgets/types"

/** Every widget document types contribute to the dashboard — see the backend's
 *  contributions/collect-widgets.ts. Never names a document type. */
export function useDashboardWidgets() {
  return useApiQuery<Widget[]>(["widgets", "dashboard"], "/api/documents/dashboard")
}

/** Same mechanism as useDashboardWidgets, for the Statistics screen. */
export function useStatisticsWidgets() {
  return useApiQuery<Widget[]>(["widgets", "statistics"], "/api/documents/statistics")
}
