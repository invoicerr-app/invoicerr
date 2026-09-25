import { useCallback } from "react"
import { useTranslation } from "react-i18next"

import { useApiQuery } from "@/hooks/use-api-query"
import type { DashboardPeriodRange } from "@/lib/dashboard-period"
import { translateWidget } from "@/lib/descriptor-i18n"

import type { Widget } from "@/components/widgets/types"

/**
 * Every widget document types contribute to the dashboard — see the backend's
 * contributions/collect-widgets.ts. Never names a document type. Each widget's own `label` is
 * translated here (see lib/descriptor-i18n.ts's own header):
 * `Widget`/`MetricWidgetRenderer`/`TimeSeriesWidgetRenderer`/`ShortListWidgetRenderer`/
 * `TableWidgetRenderer` all only ever read `widget.label` off what this hook (or
 * `useStatisticsWidgets` below) hands them, so translating it here, once, reaches every widget kind
 * with no change to any renderer.
 *
 * `range` (issue #418) is the dashboard's own period, already resolved to concrete `YYYY-MM-DD`
 * bounds by `lib/dashboard-period.ts` - this hook never resolves a preset itself, it only forwards
 * whatever the caller already resolved. `undefined` (the default) is the pre-#418 request shape,
 * byte-identical: no query string appended at all. The range is part of the query KEY too, so
 * picking a different period is a genuinely different query - a stale cached response for "this
 * month" is never shown while "this year" is loading.
 */
export function useDashboardWidgets(range?: DashboardPeriodRange) {
  const { t } = useTranslation()
  const select = useCallback((data: Widget[]) => data.map((widget) => translateWidget(t, widget)), [t])
  const query = range ? `?dateFrom=${range.dateFrom}&dateTo=${range.dateTo}` : ""
  return useApiQuery<Widget[]>(
    ["widgets", "dashboard", range?.dateFrom, range?.dateTo],
    `/api/documents/dashboard${query}`,
    { select },
  )
}

/** Same mechanism as useDashboardWidgets, for the Statistics screen. */
export function useStatisticsWidgets() {
  const { t } = useTranslation()
  const select = useCallback((data: Widget[]) => data.map((widget) => translateWidget(t, widget)), [t])
  return useApiQuery<Widget[]>(["widgets", "statistics"], "/api/documents/statistics", { select })
}
