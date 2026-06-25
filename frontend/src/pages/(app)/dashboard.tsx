import {
    AlertCircle,
    ArrowDownRight,
    ArrowRight,
    ArrowUpRight,
    CheckCircle,
    Clock,
    DollarSign,
    FileText,
    LayoutDashboard,
    ReceiptText,
    TrendingUp,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { CartesianGrid, Line, LineChart, XAxis } from "recharts"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { InvoiceList } from "@/pages/(app)/invoices/_components/invoice-list"
import { QuoteList } from "@/pages/(app)/quotes/_components/quote-list"
import type React from "react"
import { usePageHeader } from "@/hooks/use-page-header"
import { useDashboard } from "@/hooks/queries"
import { useTranslation } from "react-i18next"

export default function Dashboard() {
    const { t, i18n } = useTranslation()

    const { data: dashboardData } = useDashboard()

    usePageHeader(t("dashboard.title"), <LayoutDashboard className="h-5 w-5 text-blue-600" />)

    usePageHeader(t("dashboard.title"), <LayoutDashboard className="h-5 w-5 text-blue-600" />)

    const formatCurrency = (amount: number | null | undefined) => {
        return new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: dashboardData?.company?.currency || "USD",
        }).format(amount || 0)
    }

    const formatChangePercent = (percent = 0) => {
        const sign = percent > 0 ? "+" : ""
        return `${sign}${percent.toFixed(1)}%`
    }

    const chartConfig = {
        real: {
            label: t("dashboard.revenue.real"),
            color: "hsl(142 71% 45%)",
        },
        forecast: {
            label: t("dashboard.revenue.forecast"),
            color: "hsl(217 91% 60%)",
        },
    }

    const chartCurrency = dashboardData?.company?.currency || "USD"

    // Tooltip row: colored dot + series label, then the amount with the currency on the right.
    const formatTooltipItem = (value: any, name: any, item: any) => {
        const label = chartConfig[name as keyof typeof chartConfig]?.label ?? name
        const amount = new Intl.NumberFormat(i18n.language || "en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(Number(value) || 0)
        return (
            <div className="flex items-center gap-2 w-full">
                <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: item?.color }} />
                <span className="text-muted-foreground">{label}</span>
                <span className="ml-auto font-mono font-medium tabular-nums text-foreground">
                    {amount} {chartCurrency}
                </span>
            </div>
        )
    }

    return (
        <div className="max-w-7xl mx-auto space-y-6 p-6">
            <section className="space-y-6">
                <div className="flex items-center space-x-3">
                    <div className="p-2 bg-emerald-500 rounded-lg">
                        <DollarSign className="h-5 w-5 text-white" />
                    </div>
                    <div>
                        <h2 className="text-xl font-semibold text-foreground">{t("dashboard.revenue.title")}</h2>
                        <p className="text-sm text-muted-foreground">{t("dashboard.revenue.description")}</p>
                    </div>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                    <Card className="col-span-2">
                        <CardContent className="px-6">
                            <div className="flex items-start justify-between">
                                <div className="w-full space-y-4">
                                    <section className="flex flex-row justify-between items-start">
                                        <section>
                                            <p className="text-muted-foreground text-sm font-medium">{t("dashboard.revenue.thisMonth")}</p>
                                            <section className="flex flex-row gap-4">
                                                <p className="text-2xl font-bold text-foreground">
                                                    {formatCurrency(dashboardData?.revenue.currentMonth)}
                                                </p>
                                                <div className="flex items-center mt-2">
                                                    {(dashboardData?.revenue.monthlyChangePercent || 0) > 0 ? (
                                                        <ArrowUpRight className="h-4 w-4 text-emerald-600" />
                                                    ) : (dashboardData?.revenue.monthlyChangePercent || 0) < 0 ? (
                                                        <ArrowDownRight className="h-4 w-4 text-red-600" />
                                                    ) : (
                                                        <ArrowRight className="h-4 w-4 text-gray-400" />
                                                    )}
                                                    <span
                                                        className={`text-sm ml-1 ${(dashboardData?.revenue.monthlyChangePercent || 0) > 0
                                                            ? "text-emerald-600"
                                                            : (dashboardData?.revenue.monthlyChangePercent || 0) < 0
                                                                ? "text-red-600"
                                                                : "text-gray-400"
                                                            }`}
                                                    >
                                                        {formatChangePercent(dashboardData?.revenue.monthlyChangePercent)}
                                                    </span>
                                                </div>
                                            </section>
                                        </section>
                                        <div className="p-3 bg-emerald-500 rounded-full">
                                            <DollarSign className="h-6 w-6 text-white" />
                                        </div>
                                    </section>
                                    <ChartContainer config={chartConfig} className="h-40 w-full">
                                        <LineChart
                                            accessibilityLayer
                                            data={(dashboardData?.revenue.last6Months || [])
                                                .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
                                                .map((item) => ({
                                                    createdAt: new Date(item.createdAt),
                                                    real: item.real,
                                                    forecast: item.forecast,
                                                }))}
                                            margin={{
                                                top: 5,
                                                right: 10,
                                                left: 10,
                                                bottom: 5,
                                            }}
                                        >
                                            <CartesianGrid />
                                            <XAxis
                                                dataKey="createdAt"
                                                tickFormatter={(date) =>
                                                    new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(date))
                                                }
                                            />
                                            <ChartTooltip content={<ChartTooltipContent formatter={formatTooltipItem} />} />
                                            <ChartLegend content={<ChartLegendContent />} />
                                            <Line
                                                type="bump"
                                                strokeWidth={2}
                                                dataKey="real"
                                                stroke="var(--color-real)"
                                                isAnimationActive={false}
                                                activeDot={{ r: 6 }}
                                            />
                                            <Line
                                                type="bump"
                                                strokeWidth={2}
                                                dataKey="forecast"
                                                stroke="var(--color-forecast)"
                                                strokeDasharray="4 4"
                                                isAnimationActive={false}
                                                activeDot={{ r: 6 }}
                                            />
                                        </LineChart>
                                    </ChartContainer>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="col-span-2">
                        <CardContent className="px-6">
                            <div className="flex items-start justify-between">
                                <div className="w-full space-y-4">
                                    <section className="flex flex-row justify-between items-start">
                                        <section>
                                            <p className="text-muted-foreground text-sm font-medium">{t("dashboard.revenue.thisYear")}</p>
                                            <section className="flex flex-row gap-4">
                                                <p className="text-2xl font-bold text-foreground">
                                                    {formatCurrency(dashboardData?.revenue.currentYear)}
                                                </p>
                                                <div className="flex items-center mt-2">
                                                    {(dashboardData?.revenue.yearlyChangePercent || 0) > 0 ? (
                                                        <ArrowUpRight className="h-4 w-4 text-emerald-600" />
                                                    ) : (dashboardData?.revenue.yearlyChangePercent || 0) < 0 ? (
                                                        <ArrowDownRight className="h-4 w-4 text-red-600" />
                                                    ) : (
                                                        <ArrowRight className="h-4 w-4 text-gray-400" />
                                                    )}
                                                    <span
                                                        className={`text-sm ml-1 ${(dashboardData?.revenue.yearlyChangePercent || 0) > 0
                                                            ? "text-emerald-600"
                                                            : (dashboardData?.revenue.yearlyChangePercent || 0) < 0
                                                                ? "text-red-600"
                                                                : "text-gray-400"
                                                            }`}
                                                    >
                                                        {formatChangePercent(dashboardData?.revenue.yearlyChangePercent)}
                                                    </span>
                                                </div>
                                            </section>
                                        </section>
                                        <div className="p-3 bg-blue-500 rounded-full">
                                            <TrendingUp className="h-6 w-6 text-white" />
                                        </div>
                                    </section>
                                    <ChartContainer config={chartConfig} className="h-40 w-full">
                                        <LineChart
                                            accessibilityLayer
                                            data={(dashboardData?.revenue.last6Years || [])
                                                .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
                                                .map((item) => ({
                                                    createdAt: new Date(item.createdAt),
                                                    real: item.real,
                                                    forecast: item.forecast,
                                                }))}
                                            margin={{
                                                top: 5,
                                                right: 10,
                                                left: 10,
                                                bottom: 5,
                                            }}
                                        >
                                            <CartesianGrid />
                                            <XAxis
                                                dataKey="createdAt"
                                                tickFormatter={(date) =>
                                                    new Intl.DateTimeFormat("en-US", { year: "numeric" }).format(new Date(date))
                                                }
                                            />
                                            <ChartTooltip content={<ChartTooltipContent formatter={formatTooltipItem} />} />
                                            <ChartLegend content={<ChartLegendContent />} />
                                            <Line
                                                type="bump"
                                                strokeWidth={2}
                                                isAnimationActive={false}
                                                dataKey="real"
                                                stroke="var(--color-real)"
                                                activeDot={{ r: 6 }}
                                            />
                                            <Line
                                                type="bump"
                                                strokeWidth={2}
                                                isAnimationActive={false}
                                                dataKey="forecast"
                                                stroke="var(--color-forecast)"
                                                strokeDasharray="4 4"
                                                activeDot={{ r: 6 }}
                                            />
                                        </LineChart>
                                    </ChartContainer>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </section>

            <section className="space-y-6">
                <div className="flex items-center space-x-3">
                    <div className="p-2 bg-emerald-500 rounded-lg">
                        <FileText className="h-5 w-5 text-white" />
                    </div>
                    <div>
                        <h2 className="text-xl font-semibold text-foreground">{t("dashboard.quotes.title")}</h2>
                        <p className="text-sm text-muted-foreground">{t("dashboard.quotes.description")}</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
                    <DashboardStat
                        count={dashboardData?.quotes.total}
                        label={t("dashboard.quotes.stats.total")}
                        color="green"
                        icon={<FileText />}
                        className="lg:col-span-2"
                    />
                    <DashboardStat
                        count={dashboardData?.quotes.draft}
                        label={t("dashboard.quotes.stats.draft")}
                        icon={<Clock />}
                        color="amber"
                        className="lg:col-span-2"
                    />
                    <DashboardStat
                        count={dashboardData?.quotes.sent}
                        label={t("dashboard.quotes.stats.sent")}
                        icon={<ArrowUpRight />}
                        color="blue"
                        className="lg:col-span-2"
                    />
                    <DashboardStat
                        count={dashboardData?.quotes.signed}
                        label={t("dashboard.quotes.stats.signed")}
                        icon={<CheckCircle />}
                        color="emerald"
                        className="lg:col-span-3"
                    />
                    <DashboardStat
                        count={dashboardData?.quotes.expired}
                        label={t("dashboard.quotes.stats.expired")}
                        icon={<AlertCircle />}
                        color="red"
                        className="lg:col-span-3"
                    />
                </div>

                {dashboardData?.quotes.latests?.length ? (
                    <QuoteList
                        quotes={dashboardData.quotes.latests}
                        loading={!dashboardData}
                        title={t("dashboard.quotes.latestTitle")}
                        description=""
                        mutate={() => { }}
                        emptyState={<div className="text-center py-8 text-muted-foreground">{t("dashboard.quotes.noRecent")}</div>}
                        showCreateButton={false}
                    />
                ) : null}
            </section>

            <section className="space-y-6">
                <div className="flex items-center space-x-3">
                    <div className="p-2 bg-emerald-500 rounded-lg">
                        <ReceiptText className="h-5 w-5 text-white" />
                    </div>
                    <div>
                        <h2 className="text-xl font-semibold text-foreground">{t("dashboard.invoices.title")}</h2>
                        <p className="text-sm text-muted-foreground">{t("dashboard.invoices.description")}</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
                    <DashboardStat
                        count={dashboardData?.invoices.total}
                        label={t("dashboard.invoices.stats.total")}
                        color="green"
                        icon={<ReceiptText />}
                        className="lg:col-span-2"
                    />
                    <DashboardStat
                        count={dashboardData?.invoices.unpaid}
                        label={t("dashboard.invoices.stats.unpaid")}
                        icon={<Clock />}
                        color="amber"
                        className="lg:col-span-2"
                    />
                    <DashboardStat
                        count={dashboardData?.invoices.sent}
                        label={t("dashboard.invoices.stats.sent")}
                        icon={<ArrowUpRight />}
                        color="blue"
                        className="lg:col-span-2"
                    />
                    <DashboardStat
                        count={dashboardData?.invoices.paid}
                        label={t("dashboard.invoices.stats.paid")}
                        icon={<CheckCircle />}
                        color="emerald"
                        className="lg:col-span-3"
                    />
                    <DashboardStat
                        count={dashboardData?.invoices.overdue}
                        label={t("dashboard.invoices.stats.overdue")}
                        icon={<AlertCircle />}
                        color="red"
                        className="lg:col-span-3"
                    />
                </div>

                {dashboardData?.invoices.latests?.length ? (
                    <InvoiceList
                        invoices={dashboardData.invoices.latests}
                        loading={!dashboardData}
                        title={t("dashboard.invoices.latestTitle")}
                        description=""
                        mutate={() => { }}
                        emptyState={
                            <div className="text-center py-8 text-muted-foreground">{t("dashboard.invoices.noRecent")}</div>
                        }
                        showCreateButton={false}
                    />
                ) : null}
            </section>
        </div>
    )
}

const colorVariants = {
    green: {
        bg: "bg-green-100",
        text: "text-green-600",
        dot: "bg-green-500",
    },
    yellow: {
        bg: "bg-yellow-100",
        text: "text-yellow-600",
        dot: "bg-yellow-500",
    },
    red: {
        bg: "bg-red-100",
        text: "text-red-600",
        dot: "bg-red-500",
    },
    emerald: {
        bg: "bg-emerald-100",
        text: "text-emerald-600",
        dot: "bg-emerald-500",
    },
    blue: {
        bg: "bg-blue-100",
        text: "text-blue-600",
        dot: "bg-blue-500",
    },
    amber: {
        bg: "bg-amber-100",
        text: "text-amber-600",
        dot: "bg-amber-500",
    },
    neutral: {
        bg: "bg-neutral-100",
        text: "text-neutral-600",
        dot: "bg-neutral-500",
    },
} as const

function DashboardStat({
    count,
    label,
    color,
    className,
    icon,
}: {
    count?: number
    label: string
    icon?: React.ReactNode
    color: keyof typeof colorVariants
    className?: string
}) {
    const colors = colorVariants[color]

    return (
        <Card className={`w-full ${className}`}>
            <CardContent>
                <div className="flex items-center space-x-4">
                    <div className={`p-3 ${colors.bg} rounded-lg`}>
                        <div className="w-6 h-6 flex items-center justify-center">
                            {icon ? (
                                <div className={colors.text}>{icon}</div>
                            ) : (
                                <div className={`w-3 h-3 ${colors.dot} rounded-full`}></div>
                            )}
                        </div>
                    </div>
                    <div>
                        <p className="text-2xl font-semibold text-foreground">{count ?? 0}</p>
                        <p className="text-sm text-primary">{label}</p>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
