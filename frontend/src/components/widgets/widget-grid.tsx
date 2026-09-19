import { LayoutDashboard } from "lucide-react"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import { Widget as WidgetComponent } from "@/components/widgets/widget"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"

import type { Widget } from "@/components/widgets/types"

interface WidgetGridProps {
  widgets: Widget[]
  isLoading: boolean
  emptyDataCy: string
}

/** A tile-shaped placeholder — the same left accent stripe (transparent, since a skeleton has no
 *  tone to show yet) and header/body split as MetricWidgetRenderer, so the KPI row doesn't jump once
 *  real tiles land. */
function MetricSkeletonTile() {
  return (
    <Card className="gap-2 border-l-4 border-l-transparent py-4" aria-hidden="true">
      <CardHeader className="gap-0 px-4">
        <Skeleton className="h-3 w-20" />
      </CardHeader>
      <CardContent className="px-4">
        <Skeleton className="h-7 w-16" />
      </CardContent>
    </Card>
  )
}

/** A card-shaped placeholder for everything that isn't a metric tile — a list, a curve, a table:
 *  header title bar, then a body block tall enough to read as "a chart or a list is coming", never
 *  a bare grey rectangle with no relation to the card it will become. */
function CardSkeleton() {
  return (
    <Card aria-hidden="true">
      <CardHeader className="pb-2">
        <Skeleton className="h-4 w-32" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-40 w-full" />
      </CardContent>
    </Card>
  )
}

/**
 * Lays out whatever collectWidgets() (backend) returned for one location (dashboard/statistics) —
 * used identically by both pages (dashboard.tsx, statistics.tsx). Never knows which document type
 * produced a widget, only how many there are and what `kind` each one declares.
 *
 * Grouped by KIND, never by type: every "metric" first, as a compact row of KPI tiles ("summary
 * before detail" — the reading order a dashboard or a statistics page both want), then every other
 * widget in the general grid below, a "table" spanning the full row since a detailed table reads
 * poorly squeezed into a narrow column. A location that contributes ONLY metrics (or none at all)
 * still renders correctly: an empty second grid collapses to nothing, never a stray empty band.
 */
export function WidgetGrid({ widgets, isLoading, emptyDataCy }: WidgetGridProps) {
  const { t } = useTranslation()

  const { metrics, rest } = useMemo(() => {
    const metrics = widgets.filter((widget) => widget.kind === "metric")
    const rest = widgets.filter((widget) => widget.kind !== "metric")
    return { metrics, rest }
  }, [widgets])

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4" aria-hidden="true">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <MetricSkeletonTile />
          <MetricSkeletonTile />
          <MetricSkeletonTile />
          <MetricSkeletonTile />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    )
  }

  if (widgets.length === 0) {
    return (
      <EmptyState
        icon={LayoutDashboard}
        title={t("widgets.emptyTitle")}
        description={t("widgets.emptyDescription")}
        data-cy={emptyDataCy}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {metrics.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {metrics.map((widget) => (
            <WidgetComponent key={widget.id} widget={widget} />
          ))}
        </div>
      )}
      {rest.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rest.map((widget) => (
            <WidgetComponent key={widget.id} widget={widget} />
          ))}
        </div>
      )}
    </div>
  )
}
