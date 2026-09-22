import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import { WidgetGrid } from "@/components/widgets/widget-grid"
import type { TableWidget, Widget } from "@/components/widgets/types"
import { useStatisticsWidgets } from "@/hooks/queries"
import { usePageHeader } from "@/hooks/use-page-header"
import { cn } from "@/lib/utils"

type Period = "thisMonth" | "last3Months" | "last12Months" | "allTime"

const PERIODS: Period[] = ["thisMonth", "last3Months", "last12Months", "allTime"]

/** The ISO cutoff a period reaches back to from today, or `null` for "allTime" (no cutoff). Months
 *  are counted calendar-wise from the 1st, so "this month" means exactly that, not "last 30 days". */
function periodStartIso(period: Period): string | null {
  if (period === "allTime") return null
  const now = new Date()
  const monthsBack = period === "thisMonth" ? 0 : period === "last3Months" ? 3 : 12
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1))
    .toISOString()
    .slice(0, 10)
}

/** The first column whose values look like an ISO date (`YYYY-MM-DD…`) — a generic, KIND-based
 *  heuristic, never a document-type rule: any statistics table a future contribution adds is
 *  filtered by period automatically the moment one of its own columns carries dates, with no change
 *  here. A table with no such column (none exist yet) is simply left alone by `applyPeriod` below. */
function dateColumnKey(table: TableWidget): string | null {
  for (const column of table.columns) {
    const sample = table.rows.find((row) => typeof row[column.key] === "string" && row[column.key] !== "")
    if (sample && /^\d{4}-\d{2}-\d{2}/.test(String(sample[column.key]))) return column.key
  }
  return null
}

/**
 * Restricts every TABLE widget's rows to the selected period, by whichever of its own columns holds
 * a date. Metric and shortList widgets are left untouched on purpose — their own figures are either
 * already scoped to a period by the contribution that built them ("Invoiced this month") or have no
 * period at all (a running "pending" total); re-filtering them here client-side would silently
 * disagree with the number the backend itself computed.
 */
function applyPeriod(widgets: Widget[], period: Period): Widget[] {
  const startIso = periodStartIso(period)
  if (!startIso) return widgets

  return widgets.map((widget) => {
    if (widget.kind !== "table") return widget
    const table = widget as TableWidget
    const key = dateColumnKey(table)
    if (!key) return table
    return { ...table, rows: table.rows.filter((row) => String(row[key] ?? "") >= startIso) }
  })
}

interface PeriodChipProps {
  label: string
  active: boolean
  onClick: () => void
  dataCy: string
}

/** A real `<button aria-pressed>`, not a static badge — same convention as document-list.tsx's own
 *  status filter chips, so the two "pill filter" controls in this app read identically. */
function PeriodChip({ label, active, onClick, dataCy }: PeriodChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 shrink-0 items-center rounded-full border px-3 text-sm outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/50",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/70",
      )}
      data-cy={dataCy}
    >
      {label}
    </button>
  )
}

/**
 * Statistics — the SAME widget-contribution mechanism as the dashboard (see dashboard.tsx and the
 * backend's contributions/collect-widgets.ts), pulled from a SECOND location ("statistics") a
 * document type may separately opt into. "Dashboard is some visual information [...],
 * statistics is everything ultra-detailed" — the vocabulary is identical (a widget is a widget); only
 * WHICH widgets a type chooses to contribute here differs (e.g. invoice-contributions.ts's detailed
 * "All invoices" table, absent from the dashboard).
 *
 * The one thing this screen adds on top of the dashboard's own WidgetGrid: a period filter, applied
 * entirely client-side (see applyPeriod above) — the "everything, in detail" tables are the one widget
 * kind with individual, dated rows worth narrowing down; a KPI tile already names its own period.
 */
export default function Statistics() {
  const { t } = useTranslation()
  const { data: widgets = [], isLoading } = useStatisticsWidgets()
  const [period, setPeriod] = useState<Period>("allTime")

  usePageHeader(t("sidebar.navigation.stats"))

  const filteredWidgets = useMemo(() => applyPeriod(widgets, period), [widgets, period])

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-6">
      {!isLoading && widgets.length > 0 && (
        <div
          role="group"
          aria-label={t("widgets.period.ariaLabel")}
          className="-mx-1 flex gap-2 overflow-x-auto px-1 py-0.5 [scrollbar-width:none]"
          data-cy="statistics-period-filters"
        >
          {PERIODS.map((value) => (
            <PeriodChip
              key={value}
              label={t(`widgets.period.${value}`)}
              active={period === value}
              onClick={() => setPeriod(value)}
              dataCy={`statistics-period-${value}`}
            />
          ))}
        </div>
      )}
      <WidgetGrid widgets={filteredWidgets} isLoading={isLoading} emptyDataCy="statistics-empty" />
    </div>
  )
}
