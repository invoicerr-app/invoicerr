import { LayoutDashboard } from "lucide-react"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { Widget as WidgetComponent } from "@/components/widgets/widget"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

import { readWidgetLayout, saveWidgetLayout, type WidgetLayout } from "@/components/widgets/widget-layout"
import { WidgetReloadingProvider } from "@/components/widgets/widget-value"

import type { Widget } from "@/components/widgets/types"

interface WidgetGridProps {
  widgets: Widget[]
  /** Nothing to show yet: skeletons stand in for the cards. */
  isLoading: boolean
  /** The widgets on screen belong to a previous request while a new one loads. */
  isRefreshing?: boolean
  /** Names the stored skeleton layout and the grid's `data-cy` (`<location>-widgets`). */
  location: string
  emptyDataCy: string
}

/** The same left accent stripe (transparent, a skeleton has no tone yet) and header/body split as
 *  MetricWidgetRenderer. */
function MetricSkeletonTile({ height }: { height?: number }) {
  return (
    <Card
      className="gap-2 rounded-none border-0 py-5 shadow-[1px_0_0_var(--border),0_1px_0_var(--border)]"
      style={{ height }}
    >
      <CardHeader className="gap-0 px-5">
        <Skeleton className="h-3 w-20" />
      </CardHeader>
      <CardContent className="px-5">
        <Skeleton className="h-8 w-24" />
      </CardContent>
    </Card>
  )
}

/** A list, a curve or a table: a title bar, then a body filling whatever height the card had. */
function CardSkeleton({ height, className }: { height?: number; className?: string }) {
  return (
    <Card className={cn("overflow-hidden", className)} style={{ height }}>
      <CardHeader className="pb-2">
        <Skeleton className="h-4 w-32" />
      </CardHeader>
      <CardContent className={cn("min-h-0", height ? "flex-1" : "h-40")}>
        <Skeleton className="h-full w-full" />
      </CardContent>
    </Card>
  )
}

const METRICS_GRID = "grid grid-cols-2 overflow-hidden rounded-xl border bg-card shadow-sheet sm:grid-cols-4"
const REST_GRID = "grid gap-5 sm:grid-cols-2 xl:grid-cols-3"

/** Skeletons in the exact shape last measured at this width, or a generic row of tiles and two cards
 *  the first time. */
function WidgetGridSkeleton({ layout }: { layout: WidgetLayout | null }) {
  const metrics = layout?.metrics ?? [undefined, undefined, undefined, undefined]
  const rest = layout?.rest ?? [{ kind: "shortList" }, { kind: "timeSeries" }]
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      {metrics.length > 0 && (
        <div className={METRICS_GRID}>
          {metrics.map((height, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
            <MetricSkeletonTile key={index} height={height} />
          ))}
        </div>
      )}
      {rest.length > 0 && (
        <div className={REST_GRID}>
          {rest.map((item, index) => (
            <CardSkeleton
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
              key={index}
              height={"height" in item ? item.height : undefined}
              className={item.kind === "table" ? "col-span-full" : undefined}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function measureHeights(grid: HTMLElement | null) {
  return grid ? [...grid.children].map((child) => Math.round(child.getBoundingClientRect().height)) : []
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
export function WidgetGrid({
  widgets,
  isLoading,
  isRefreshing = false,
  location,
  emptyDataCy,
}: WidgetGridProps) {
  const { t } = useTranslation()
  const metricsRef = useRef<HTMLDivElement>(null)
  const restRef = useRef<HTMLDivElement>(null)
  const [skeletonLayout, setSkeletonLayout] = useState<WidgetLayout | null>(null)

  const { metrics, rest } = useMemo(() => {
    const metrics = widgets.filter((widget) => widget.kind === "metric")
    const rest = widgets.filter((widget) => widget.kind !== "metric")
    return { metrics, rest }
  }, [widgets])

  useLayoutEffect(() => {
    if (isLoading) setSkeletonLayout(readWidgetLayout(location, window.innerWidth))
  }, [isLoading, location])

  useEffect(() => {
    if (isLoading || isRefreshing || widgets.length === 0) return
    const restHeights = measureHeights(restRef.current)
    saveWidgetLayout(location, {
      width: window.innerWidth,
      metrics: measureHeights(metricsRef.current),
      rest: rest.map((widget, index) => ({ kind: widget.kind, height: restHeights[index] ?? 0 })),
    })
  }, [isLoading, isRefreshing, widgets, rest, location])

  if (!isLoading && widgets.length === 0) {
    return (
      <EmptyState
        icon={LayoutDashboard}
        title={t("widgets.emptyTitle")}
        description={t("widgets.emptyDescription")}
        data-cy={emptyDataCy}
      />
    )
  }

  const busy = isLoading || isRefreshing

  return (
    <div className="relative" aria-busy={busy} data-cy={`${location}-widgets`}>
      <span role="status" className="sr-only">
        {busy ? t("widgets.loading") : ""}
      </span>
      {isLoading ? (
        <WidgetGridSkeleton layout={skeletonLayout} />
      ) : (
        <WidgetReloadingProvider value={isRefreshing}>
          <div className="flex flex-col gap-6">
            {metrics.length > 0 && (
              <div ref={metricsRef} className={METRICS_GRID}>
                {metrics.map((widget) => (
                  <WidgetComponent key={widget.id} widget={widget} />
                ))}
              </div>
            )}
            {rest.length > 0 && (
              <div ref={restRef} className={REST_GRID}>
                {rest.map((widget) => (
                  <WidgetComponent key={widget.id} widget={widget} />
                ))}
              </div>
            )}
          </div>
        </WidgetReloadingProvider>
      )}
    </div>
  )
}
