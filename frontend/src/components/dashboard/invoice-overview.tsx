import { ArrowUpRight } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { Area, ComposedChart, CartesianGrid, Line, XAxis, YAxis } from "recharts"

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { InitialsAvatar } from "@/components/ui/initials-avatar"
import { LtrValue } from "@/components/ui/ltr-value"
import { Skeleton } from "@/components/ui/skeleton"
import { buildMetricLinkHref } from "@/components/widgets/metric-link"
import { useInvoiceOverview, type InvoiceOverview } from "@/hooks/queries"
import { cn } from "@/lib/utils"

const PANEL = "rounded-xl border bg-card shadow-sheet"

function useFormat() {
  const { i18n } = useTranslation()
  const locale = i18n.language
  return {
    money: (value: number, currency: string) =>
      `${value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`,
    monthName: (key: string, style: "long" | "short" = "long") =>
      new Date(`${key}-01T00:00:00Z`).toLocaleDateString(locale, { month: style, timeZone: "UTC" }),
    weekday: (iso: string) =>
      new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, { weekday: "short", timeZone: "UTC" }),
    day: (iso: string) =>
      new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, { day: "2-digit", timeZone: "UTC" }),
  }
}

function previousMonthKey(key: string): string {
  const [year, month] = key.split("-").map(Number)
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7)
}

function InvoicedCard({ overview }: { overview: InvoiceOverview }) {
  const { t } = useTranslation()
  const format = useFormat()
  const diff = overview.invoicedThisMonth - overview.invoicedLastMonth
  const lastMonth = format.monthName(previousMonthKey(overview.month))
  const comparison =
    diff === 0
      ? t("dashboard.overview.comparisonSame", { month: lastMonth })
      : t(diff > 0 ? "dashboard.overview.comparisonMore" : "dashboard.overview.comparisonLess", {
          amount: format.money(Math.abs(diff), overview.currency),
          month: lastMonth,
        })
  const chartData = overview.months.map((month) => ({
    ...month,
    label: format.monthName(month.month, "short"),
  }))
  const chartConfig: ChartConfig = {
    collected: { label: t("dashboard.overview.legendCollected"), color: "var(--chart-1)" },
    expected: { label: t("dashboard.overview.legendExpected"), color: "var(--chart-1)" },
  }

  return (
    <section className={cn(PANEL, "p-5 sm:p-7")} data-cy="dashboard-overview-invoiced">
      <p className="text-[14px] font-semibold text-ink-2">
        {t("dashboard.overview.invoicedIn", { month: format.monthName(overview.month) })}
        <span className="ms-2 font-normal text-muted-foreground">{t("dashboard.overview.exclVat")}</span>
      </p>
      <p className="amount mt-1 text-[44px] leading-none text-foreground sm:text-[56px]">
        <LtrValue data-cy="dashboard-overview-invoiced-amount">
          {format.money(overview.invoicedThisMonth, overview.currency)}
        </LtrValue>
      </p>
      <p className="mt-3 text-sm text-ink-2">{comparison}</p>

      <div className="mt-6 max-sm:hidden" data-cy="dashboard-overview-chart">
        <ChartContainer config={chartConfig} className="aspect-auto h-56 w-full">
          <ComposedChart data={chartData} margin={{ left: 0, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval={0} />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={56}
              tickFormatter={(value) => value.toLocaleString()}
            />
            <ChartTooltip content={<ChartTooltipContent hideIndicator />} />
            <Area
              dataKey="collected"
              type="linear"
              stroke="var(--color-collected)"
              strokeWidth={2}
              fill="var(--color-collected)"
              fillOpacity={0.14}
              connectNulls={false}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="expected"
              type="linear"
              stroke="var(--color-expected)"
              strokeWidth={2}
              strokeDasharray="5 5"
              connectNulls={false}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ChartContainer>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-ink-2">
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="h-0.5 w-4 bg-chart-1" />
            {t("dashboard.overview.legendCollected")}
          </span>
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="w-4 border-t-2 border-dashed border-chart-1" />
            {t("dashboard.overview.legendExpected")}
          </span>
        </div>
      </div>
    </section>
  )
}

function ToChaseCard({ overview }: { overview: InvoiceOverview }) {
  const { t } = useTranslation()
  const format = useFormat()
  const rows = overview.toChase.slice(0, 5)
  return (
    <section className={cn(PANEL, "p-5")} data-cy="dashboard-overview-to-chase">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl">{t("dashboard.overview.toChase")}</h2>
        {overview.toChase.length > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive-soft px-2.5 py-0.5 text-[13px] font-semibold text-destructive-soft-foreground">
            <svg viewBox="0 0 12 12" aria-hidden="true" className="size-3">
              <path d="M6 1.5 11 10.5H1z" fill="currentColor" />
            </svg>
            {overview.toChase.length}
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-ink-2">{t("dashboard.overview.nothingToChase")}</p>
      ) : (
        <ul className="mt-3 divide-y border-t">
          {rows.map((row) => (
            <li key={`${row.clientId}-${row.currency}`} className="flex items-center gap-3 py-3">
              <InitialsAvatar name={row.client} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-foreground">
                  {row.client ?? t("dashboard.overview.noClient")}
                </p>
                <p className="text-[13.5px] text-muted-foreground">
                  {t("dashboard.overview.daysLate", { count: row.daysLate })}
                  {row.invoiceCount > 1 && (
                    <span className="ms-2">
                      {t("dashboard.overview.invoiceCount", { count: row.invoiceCount })}
                    </span>
                  )}
                </p>
              </div>
              <span className="amount shrink-0 text-base whitespace-nowrap text-foreground">
                <LtrValue>{format.money(row.outstanding, row.currency)}</LtrValue>
              </span>
            </li>
          ))}
        </ul>
      )}
      {overview.toChase.length > 0 && (
        <Link
          to={buildMetricLinkHref({ typeId: "invoice", status: ["sent", "imported"], settlement: "overdue" })}
          className="focus-ring mt-2 flex h-[38px] items-center justify-center gap-2 rounded-md border text-sm font-semibold text-foreground transition-colors duration-150 hover:bg-sunken"
          data-cy="dashboard-overview-to-chase-link"
        >
          {t("dashboard.overview.seeLate")}
          <ArrowUpRight className="size-4" aria-hidden="true" />
        </Link>
      )}
    </section>
  )
}

function ThisWeekCard({ overview }: { overview: InvoiceOverview }) {
  const { t } = useTranslation()
  const format = useFormat()
  return (
    <section className={cn(PANEL, "p-5")} data-cy="dashboard-overview-this-week">
      <h2 className="text-xl">{t("dashboard.overview.thisWeek")}</h2>
      {overview.thisWeek.length === 0 ? (
        <p className="mt-4 text-sm text-ink-2">{t("dashboard.overview.nothingThisWeek")}</p>
      ) : (
        <ul className="mt-3 divide-y border-t">
          {overview.thisWeek.slice(0, 5).map((row) => (
            <li key={row.documentId}>
              <Link
                to={`/documents/invoice/${row.documentId}`}
                className="focus-ring flex items-center gap-4 rounded-sm py-3 outline-none"
              >
                <span className="w-9 shrink-0 text-center leading-none">
                  <span className="block text-xs text-muted-foreground">{format.weekday(row.dueDate)}</span>
                  <span className="amount mt-1 block text-xl text-foreground">{format.day(row.dueDate)}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-foreground">
                    {row.client ?? t("dashboard.overview.noClient")}
                  </span>
                  <span className="block truncate text-[13.5px] text-muted-foreground">
                    {t("dashboard.overview.dueLine", { number: row.displayNumber ?? "" })}
                  </span>
                </span>
                <span className="amount shrink-0 text-base whitespace-nowrap text-foreground">
                  <LtrValue>{format.money(row.outstanding, row.currency)}</LtrValue>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** The top of the dashboard: the month's invoicing with collections over the year, then the clients
 *  to chase and what falls due this week. */
export function InvoiceOverviewPanel() {
  const { data: overview, isLoading, isError } = useInvoiceOverview()
  if (isError) return null
  if (isLoading || !overview) {
    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]" aria-hidden="true">
        <Skeleton className="h-[26rem] rounded-xl" />
        <div className="space-y-6">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      </div>
    )
  }
  return (
    <div
      className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] [&>*]:min-w-0"
      data-cy="dashboard-overview"
    >
      <InvoicedCard overview={overview} />
      <div className="min-w-0 space-y-6">
        <ToChaseCard overview={overview} />
        <ThisWeekCard overview={overview} />
      </div>
    </div>
  )
}
