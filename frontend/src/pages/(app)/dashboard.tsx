import { format } from "date-fns"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router"

import { InvoiceOverviewPanel } from "@/components/dashboard/invoice-overview"
import { DatePicker } from "@/components/date-picker"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { WidgetGrid } from "@/components/widgets/widget-grid"
import { useDashboardWidgets } from "@/hooks/queries"
import { usePageHeader } from "@/hooks/use-page-header"
import { fromCalendarDate, toCalendarDate } from "@/lib/calendar-date"
import {
  DASHBOARD_PERIOD_PRESETS,
  dashboardPeriodToParams,
  type DashboardPeriodPreset,
  parseDashboardPeriodParams,
  resolveDashboardPeriod,
} from "@/lib/dashboard-period"
import { authClient } from "@/lib/auth"
import { languageToLocale } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/** The period selector's own header (issue #418): kept in URL search params (`period`, plus
 *  `dateFrom`/`dateTo` for "custom") - reload and the back button from a tile's own filtered list
 *  both restore the exact selection, the same "the URL is the state" convention
 *  `[typeId]/index.tsx`'s own filters already hold. `resolveDashboardPeriod` (lib/dashboard-period.ts)
 *  turns the selection into concrete `YYYY-MM-DD` bounds using the BROWSER's local calendar; the
 *  backend only ever sees those bounds, never the preset name itself. */
function DashboardPeriodSelector() {
  const { t, i18n } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const selection = parseDashboardPeriodParams(searchParams)

  const applyPatch = (patch: Record<string, string | undefined>) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined) next.delete(key)
          else next.set(key, value)
        }
        return next
      },
      { replace: true },
    )
  }

  const range = resolveDashboardPeriod(selection)
  const locale = languageToLocale(i18n.language)
  // Both bounds are YYYY-MM-DD, so a plain string comparison orders them.
  const customRangeInverted =
    selection.preset === "custom" &&
    !!selection.dateFrom &&
    !!selection.dateTo &&
    selection.dateFrom > selection.dateTo

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={selection.preset}
        onValueChange={(value) =>
          applyPatch(dashboardPeriodToParams({ preset: value as DashboardPeriodPreset }))
        }
      >
        <SelectTrigger
          className="w-full sm:w-48"
          aria-label={t("dashboard.period.label")}
          dataCy="dashboard-period-select"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DASHBOARD_PERIOD_PRESETS.map((preset) => (
            <SelectItem key={preset} value={preset} dataCy={`dashboard-period-option-${preset}`}>
              {t(`dashboard.period.options.${preset}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selection.preset === "custom" && (
        <div className="flex items-center gap-1">
          <DatePicker
            value={fromCalendarDate(selection.dateFrom)}
            onChange={(date) =>
              applyPatch({ period: "custom", dateFrom: toCalendarDate(date), dateTo: selection.dateTo })
            }
            placeholder={t("dashboard.period.customFrom")}
            className="w-auto sm:w-44"
            data-cy="dashboard-period-custom-from"
          />
          <DatePicker
            value={fromCalendarDate(selection.dateTo)}
            onChange={(date) =>
              applyPatch({ period: "custom", dateFrom: selection.dateFrom, dateTo: toCalendarDate(date) })
            }
            placeholder={t("dashboard.period.customTo")}
            className="w-auto sm:w-44"
            data-cy="dashboard-period-custom-to"
          />
        </div>
      )}

      {/* A custom range that does not resolve (a bound missing, or the start after the end) falls back
          to "all time" for the data, as dashboard-period.ts decides. The line below must then say WHY,
          never "Showing all time" next to two filled date pickers: that reads as the dates having been
          applied. Seen on the #418 screenshots with an inverted range. */}
      <span
        // Two lines held on a phone, where a dated range wraps and "all time" does not: picking a
        // period must not push the cards down.
        className={cn(
          "min-h-[2lh] text-sm text-muted-foreground sm:min-h-0",
          customRangeInverted && "text-destructive",
        )}
        data-cy="dashboard-period-range"
      >
        {range
          ? t("dashboard.period.activeRange", {
              from: format(fromCalendarDate(range.dateFrom) as Date, "PPP", { locale }),
              to: format(fromCalendarDate(range.dateTo) as Date, "PPP", { locale }),
            })
          : customRangeInverted
            ? t("dashboard.period.customInverted")
            : selection.preset === "custom"
              ? t("dashboard.period.customIncomplete")
              : t("dashboard.period.activeRangeAll")}
      </span>
    </div>
  )
}

/**
 * The dashboard, rebuilt on the widget-contribution mechanism (see the backend's
 * contributions/collect-widgets.ts): every document type that declares a "dashboard" contribution
 * gets to add its own widgets here — "certaines informations visuelles" per the task's own wording —
 * this page never names which type produced which widget, or even how many types there are. The
 * invoice is the first (and, for now, only) real contributor — see
 * backend/src/modules/documents/contributions/invoice-contributions.ts.
 *
 * The period selector (issue #418) is read from the URL and resolved once here, then fed to
 * `useDashboardWidgets` - every widget re-fetches and re-scopes together the moment the selection
 * changes, since the resolved range is part of that hook's own query key. Picking "All time" (the
 * default) resolves to `undefined`, which is the exact pre-#418 request shape: no query string
 * appended, no behavior change for anyone who never touches the selector.
 */
export default function Dashboard() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const range = resolveDashboardPeriod(parseDashboardPeriodParams(searchParams))
  const { data: widgets = [], isLoading, isPlaceholderData } = useDashboardWidgets(range)

  const { data: session } = authClient.useSession()
  const firstname = (session?.user as { firstname?: string } | undefined)?.firstname
  usePageHeader(firstname ? t("dashboard.hello", { name: firstname }) : t("dashboard.title"))

  return (
    <div className="page-content space-y-6">
      <p className="-mt-1 text-[15px] text-ink-2" data-cy="dashboard-greeting">
        {t("dashboard.subtitle")}
      </p>
      <InvoiceOverviewPanel />
      <section className="space-y-4 pt-4" aria-labelledby="dashboard-all-figures">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="dashboard-all-figures" className="text-xl">
            {t("dashboard.allFigures")}
          </h2>
          <DashboardPeriodSelector />
        </div>
        <WidgetGrid
          widgets={widgets}
          isLoading={isLoading}
          isRefreshing={isPlaceholderData}
          location="dashboard"
          emptyDataCy="dashboard-empty"
        />
      </section>
    </div>
  )
}
