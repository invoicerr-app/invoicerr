import { useTranslation } from "react-i18next"

import { Widget as WidgetComponent } from "@/components/widgets/widget"
import type { Widget } from "@/components/widgets/types"

interface WidgetGridProps {
  widgets: Widget[]
  isLoading: boolean
  emptyDataCy: string
}

/**
 * Lays out whatever collectWidgets() (backend) returned for one location (dashboard/statistics) —
 * used identically by both pages (dashboard.tsx, statistics.tsx). Never knows which document type
 * produced a widget, only how many there are and what `kind` each one declares (via WidgetComponent).
 * A "table" widget spans the full row (see table-widget.tsx's own `col-span-full`) since a detailed
 * table reads poorly squeezed into a narrow column; every other kind shares the grid evenly.
 */
export function WidgetGrid({ widgets, isLoading, emptyDataCy }: WidgetGridProps) {
  const { t } = useTranslation()

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((key) => (
          <div key={key} className="h-40 animate-pulse rounded-lg border bg-muted/40" />
        ))}
      </div>
    )
  }

  if (widgets.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground" data-cy={emptyDataCy}>
        {t("widgets.empty")}
      </div>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {widgets.map((widget) => (
        <WidgetComponent key={widget.id} widget={widget} />
      ))}
    </div>
  )
}
