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
} from 'lucide-react';
import type React from 'react';
import { useTranslation } from 'react-i18next';
import { CartesianGrid, Line, LineChart, XAxis } from 'recharts';
import { Card, CardContent } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { useSse } from '@/hooks/use-fetch';
import { authClient } from '@/lib/auth';
import { InvoiceList } from '@/pages/(app)/invoices/_components/invoice-list';
import { QuoteList } from '@/pages/(app)/quotes/_components/quote-list';
import type { Company, Invoice, Quote } from '@/types';

interface DashboardData {
  company: Company | null;
  quotes: {
    total: number;
    draft: number;
    sent: number;
    signed: number;
    expired: number;
    latests: Quote[];
  };
  invoices: {
    total: number;
    unpaid: number;
    sent: number;
    paid: number;
    overdue: number;
    latests: Invoice[];
  };
  clients: {
    total: number;
  };
  revenue: {
    last6Months: { createdAt: Date; total: number }[];
    currentMonth: number;
    previousMonth: number;
    monthlyChange: number;
    monthlyChangePercent: number;
    last6Years: { createdAt: Date; total: number }[];
    currentYear: number;
    previousYear: number;
    yearlyChange: number;
    yearlyChangePercent: number;
  };
}

export default function Dashboard() {
  const { t } = useTranslation();

  const { data: user } = authClient.useSession();

  const { data: dashboardData } = useSse<DashboardData>('/api/dashboard/sse');

  const formatCurrency = (amount: number | null | undefined) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: dashboardData?.company?.currency || 'USD',
    }).format(amount || 0);
  };

  const formatChangePercent = (percent = 0) => {
    const sign = percent > 0 ? '+' : '';
    return `${sign}${percent.toFixed(1)}%`;
  };

  const chartConfig = {
    revenue: {
      label: t('dashboard.revenue.chartLabel'),
      color: 'hsl(var(--primary))',
    },
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 p-6">
      <div className="flex items-center space-x-3">
        <div className="p-2 bg-blue-100 rounded-lg">
          <LayoutDashboard className="h-5 w-5 text-blue-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('dashboard.title')}</h1>
          <p className="text-muted-foreground">
            {t('dashboard.welcomeMessage', { firstname: user?.user?.name?.split(' ')[0] || '' })}
          </p>
        </div>
      </div>

      <section className="space-y-6">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-emerald-500 rounded-lg">
            <DollarSign className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-foreground">
              {t('dashboard.revenue.title')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('dashboard.revenue.description')}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className="col-span-2">
            <CardContent className="px-6">
              <div className="flex items-start justify-between">
                <div className="w-full space-y-4">
                  <section className="flex flex-row justify-between items-start">
                    <section>
                      <p className="text-muted-foreground text-sm font-medium">
                        {t('dashboard.revenue.thisMonth')}
                      </p>
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
                            className={`text-sm ml-1 ${
                              (dashboardData?.revenue.monthlyChangePercent || 0) > 0
                                ? 'text-emerald-600'
                                : (dashboardData?.revenue.monthlyChangePercent || 0) < 0
                                  ? 'text-red-600'
                                  : 'text-gray-400'
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
                  <ChartContainer config={chartConfig} className="h-32 w-full">
                    <LineChart
                      accessibilityLayer
                      data={(dashboardData?.revenue.last6Months || [])
                        .sort(
                          (a, b) =>
                            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
                        )
                        .map((item) => ({
                          createdAt: new Date(item.createdAt),
                          revenue: item.total,
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
                          new Intl.DateTimeFormat('en-US', {
                            month: 'short',
                            day: 'numeric',
                          }).format(new Date(date))
                        }
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Line
                        type="bump"
                        strokeWidth={2}
                        dataKey="revenue"
                        stroke="var(--color-white)"
                        isAnimationActive={false}
                        activeDot={{
                          r: 6,
                        }}
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
                      <p className="text-muted-foreground text-sm font-medium">
                        {t('dashboard.revenue.thisYear')}
                      </p>
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
                            className={`text-sm ml-1 ${
                              (dashboardData?.revenue.yearlyChangePercent || 0) > 0
                                ? 'text-emerald-600'
                                : (dashboardData?.revenue.yearlyChangePercent || 0) < 0
                                  ? 'text-red-600'
                                  : 'text-gray-400'
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
                  <ChartContainer config={chartConfig} className="h-32 w-full">
                    <LineChart
                      accessibilityLayer
                      data={(dashboardData?.revenue.last6Years || [])
                        .sort(
                          (a, b) =>
                            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
                        )
                        .map((item) => ({
                          createdAt: new Date(item.createdAt),
                          revenue: item.total,
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
                          new Intl.DateTimeFormat('en-US', {
                            month: 'short',
                            day: 'numeric',
                          }).format(new Date(date))
                        }
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Line
                        type="bump"
                        strokeWidth={2}
                        isAnimationActive={false}
                        dataKey="revenue"
                        stroke="var(--color-white)"
                        activeDot={{
                          r: 6,
                        }}
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
            <h2 className="text-xl font-semibold text-foreground">{t('dashboard.quotes.title')}</h2>
            <p className="text-sm text-muted-foreground">{t('dashboard.quotes.description')}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
          <DashboardStat
            count={dashboardData?.quotes.total}
            label={t('dashboard.quotes.stats.total')}
            color="green"
            icon={<FileText />}
            className="lg:col-span-2"
          />
          <DashboardStat
            count={dashboardData?.quotes.draft}
            label={t('dashboard.quotes.stats.draft')}
            icon={<Clock />}
            color="amber"
            className="lg:col-span-2"
          />
          <DashboardStat
            count={dashboardData?.quotes.sent}
            label={t('dashboard.quotes.stats.sent')}
            icon={<ArrowUpRight />}
            color="blue"
            className="lg:col-span-2"
          />
          <DashboardStat
            count={dashboardData?.quotes.signed}
            label={t('dashboard.quotes.stats.signed')}
            icon={<CheckCircle />}
            color="emerald"
            className="lg:col-span-3"
          />
          <DashboardStat
            count={dashboardData?.quotes.expired}
            label={t('dashboard.quotes.stats.expired')}
            icon={<AlertCircle />}
            color="red"
            className="lg:col-span-3"
          />
        </div>

        {dashboardData?.quotes.latests?.length ? (
          <QuoteList
            quotes={dashboardData.quotes.latests}
            loading={!dashboardData}
            title={t('dashboard.quotes.latestTitle')}
            description=""
            mutate={() => {}}
            emptyState={
              <div className="text-center py-8 text-muted-foreground">
                {t('dashboard.quotes.noRecent')}
              </div>
            }
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
            <h2 className="text-xl font-semibold text-foreground">
              {t('dashboard.invoices.title')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('dashboard.invoices.description')}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
          <DashboardStat
            count={dashboardData?.invoices.total}
            label={t('dashboard.invoices.stats.total')}
            color="green"
            icon={<ReceiptText />}
            className="lg:col-span-2"
          />
          <DashboardStat
            count={dashboardData?.invoices.unpaid}
            label={t('dashboard.invoices.stats.unpaid')}
            icon={<Clock />}
            color="amber"
            className="lg:col-span-2"
          />
          <DashboardStat
            count={dashboardData?.invoices.sent}
            label={t('dashboard.invoices.stats.sent')}
            icon={<ArrowUpRight />}
            color="blue"
            className="lg:col-span-2"
          />
          <DashboardStat
            count={dashboardData?.invoices.paid}
            label={t('dashboard.invoices.stats.paid')}
            icon={<CheckCircle />}
            color="emerald"
            className="lg:col-span-3"
          />
          <DashboardStat
            count={dashboardData?.invoices.overdue}
            label={t('dashboard.invoices.stats.overdue')}
            icon={<AlertCircle />}
            color="red"
            className="lg:col-span-3"
          />
        </div>

        {dashboardData?.invoices.latests?.length ? (
          <InvoiceList
            invoices={dashboardData.invoices.latests}
            loading={!dashboardData}
            title={t('dashboard.invoices.latestTitle')}
            description=""
            mutate={() => {}}
            emptyState={
              <div className="text-center py-8 text-muted-foreground">
                {t('dashboard.invoices.noRecent')}
              </div>
            }
            showCreateButton={false}
          />
        ) : null}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">{t('dashboard.clients.title')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 gap-4">
          <DashboardStat
            count={dashboardData?.clients.total}
            label={t('dashboard.clients.stats.total')}
            color="green"
          />
        </div>
      </section>
    </div>
  );
}

const colorVariants = {
  green: {
    bg: 'bg-green-100',
    text: 'text-green-600',
    dot: 'bg-green-500',
  },
  yellow: {
    bg: 'bg-yellow-100',
    text: 'text-yellow-600',
    dot: 'bg-yellow-500',
  },
  red: {
    bg: 'bg-red-100',
    text: 'text-red-600',
    dot: 'bg-red-500',
  },
  emerald: {
    bg: 'bg-emerald-100',
    text: 'text-emerald-600',
    dot: 'bg-emerald-500',
  },
  blue: {
    bg: 'bg-blue-100',
    text: 'text-blue-600',
    dot: 'bg-blue-500',
  },
  amber: {
    bg: 'bg-amber-100',
    text: 'text-amber-600',
    dot: 'bg-amber-500',
  },
  neutral: {
    bg: 'bg-neutral-100',
    text: 'text-neutral-600',
    dot: 'bg-neutral-500',
  },
} as const;

function DashboardStat({
  count,
  label,
  color,
  className,
  icon,
}: {
  count?: number;
  label: string;
  icon?: React.ReactNode;
  color: keyof typeof colorVariants;
  className?: string;
}) {
  const colors = colorVariants[color];

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
  );
}
