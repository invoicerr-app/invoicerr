import { useCallback } from "react"
import { useTranslation } from "react-i18next"

import { useApiQuery } from "@/hooks/use-api-query"
import { translateWidget } from "@/lib/descriptor-i18n"

import type { Widget } from "@/components/widgets/types"

/**
 * Every widget document types contribute to the dashboard — see the backend's
 * contributions/collect-widgets.ts. Never names a document type. Each widget's own `label` is
 * translated here (root TODO item 25's own reliquat — see lib/descriptor-i18n.ts's own header):
 * `Widget`/`MetricWidgetRenderer`/`TimeSeriesWidgetRenderer`/`ShortListWidgetRenderer`/
 * `TableWidgetRenderer` all only ever read `widget.label` off what this hook (or
 * `useStatisticsWidgets` below) hands them, so translating it here, once, reaches every widget kind
 * with no change to any renderer.
 */
export function useDashboardWidgets() {
  const { t } = useTranslation()
  const select = useCallback((data: Widget[]) => data.map((widget) => translateWidget(t, widget)), [t])
  return useApiQuery<Widget[]>(["widgets", "dashboard"], "/api/documents/dashboard", { select })
}

/** Same mechanism as useDashboardWidgets, for the Statistics screen. */
export function useStatisticsWidgets() {
  const { t } = useTranslation()
  const select = useCallback((data: Widget[]) => data.map((widget) => translateWidget(t, widget)), [t])
  return useApiQuery<Widget[]>(["widgets", "statistics"], "/api/documents/statistics", { select })
}
