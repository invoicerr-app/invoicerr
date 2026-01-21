import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CartesianGrid, Line, LineChart, XAxis } from 'recharts';
import { Card, CardContent } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import YearPicker from '@/components/year-picker';
import { useGet } from '@/hooks/use-fetch';

type MonthStat = { month: number; invoiced: number; revenue: number; deposits: number };
type YearStat = { year: number; invoiced: number; revenue: number; deposits: number };
interface MonthlyResponse {
  currencies: { currency: string; months: MonthStat[] }[];
}
interface YearlyResponse {
  currencies: { currency: string; years: YearStat[] }[];
}

export default function StatsPage() {
  const { t, i18n } = useTranslation();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<number>(currentYear);
  const [startYear, setStartYear] = useState<number>(currentYear - 5);
  const [endYear, setEndYear] = useState<number>(currentYear);

  const { data: monthlyData } = useGet<MonthlyResponse>(`/api/stats/monthly?year=${year}`);
  const { data: yearlyData } = useGet<YearlyResponse>(
    `/api/stats/yearly?start=${startYear}&end=${endYear}`,
  );

  const monthlyCurrencies = monthlyData?.currencies || [];
  const yearlyCurrencies = yearlyData?.currencies || [];

  const [selectedMonthlyCurrency, setSelectedMonthlyCurrency] = useState<string | undefined>(
    monthlyCurrencies[0]?.currency,
  );
  const [selectedYearlyCurrency, setSelectedYearlyCurrency] = useState<string | undefined>(
    yearlyCurrencies[0]?.currency,
  );

  useEffect(() => {
    if (!selectedMonthlyCurrency && monthlyCurrencies.length) {
      setSelectedMonthlyCurrency(monthlyCurrencies[0].currency);
    }
  }, [monthlyCurrencies, selectedMonthlyCurrency]);

  useEffect(() => {
    if (!selectedYearlyCurrency && yearlyCurrencies.length) {
      setSelectedYearlyCurrency(yearlyCurrencies[0].currency);
    }
  }, [yearlyCurrencies, selectedYearlyCurrency]);

  const monthsForCurrency = useMemo(() => {
    return (
      monthlyData?.currencies.find((c) => c.currency === selectedMonthlyCurrency)?.months ?? []
    );
  }, [monthlyData, selectedMonthlyCurrency]);

  const yearsForCurrency = useMemo(() => {
    return yearlyData?.currencies.find((c) => c.currency === selectedYearlyCurrency)?.years ?? [];
  }, [yearlyData, selectedYearlyCurrency]);

  const formatCurrency = (val?: number, currencyParam?: string) => {
    const currency = currencyParam ?? selectedMonthlyCurrency ?? selectedYearlyCurrency ?? 'EUR';
    try {
      const formatted = new Intl.NumberFormat(i18n.language || 'en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(val ?? 0);
      return `${formatted} ${currency}`;
    } catch {
      return `${val?.toFixed(2) ?? '0.00'} ${currency}`;
    }
  };

  const monthsChartData = monthsForCurrency.map((m) => ({
    month: m.month,
    label: new Date(year, m.month - 1, 1),
    invoiced: m.invoiced,
    revenue: m.revenue,
    deposits: m.deposits,
  }));

  const yearsChartData = yearsForCurrency.map((y) => ({
    year: y.year,
    label: new Date(y.year, 0, 1),
    invoiced: y.invoiced,
    revenue: y.revenue,
    deposits: y.deposits,
  }));

  const chartConfig = {
    invoiced: { label: t('stats.invoiced'), color: 'hsl(var(--primary))' },
    revenue: { label: t('stats.revenue'), color: 'hsl(var(--primary))' },
    deposits: { label: t('stats.deposits'), color: 'hsl(var(--primary))' },
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 p-6">
      <div className="flex items-center space-x-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('stats.title')}</h1>
          <p className="text-muted-foreground">{t('stats.description')}</p>
        </div>
      </div>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <label className="text-sm text-muted-foreground">{t('stats.controls.year')}</label>
            <YearPicker
              startYear={2000}
              endYear={new Date().getFullYear()}
              value={year}
              onChange={setYear}
            />
          </div>
          <div className="flex items-center space-x-2">
            {monthlyCurrencies.length ? (
              <Select
                value={selectedMonthlyCurrency ?? undefined}
                onValueChange={(v: string) => setSelectedMonthlyCurrency(v)}
              >
                <SelectTrigger size="sm">
                  <SelectValue placeholder={t('stats.controls.year')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {monthlyCurrencies.map((c) => (
                      <SelectItem key={c.currency} value={c.currency}>
                        {c.currency}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            ) : null}
          </div>
        </div>

        <Card>
          <CardContent>
            <div className="flex items-start justify-between">
              <div className="w-full space-y-4">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-sm text-muted-foreground">{t('stats.monthly.title')}</p>
                    <p className="text-2xl font-bold">
                      {selectedMonthlyCurrency
                        ? formatCurrency(
                            monthsForCurrency.reduce((s, m) => s + m.revenue, 0),
                            selectedMonthlyCurrency,
                          )
                        : '-'}
                    </p>
                  </div>
                </div>
                <ChartContainer config={chartConfig} className="h-44 w-full">
                  <LineChart
                    data={monthsChartData}
                    margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
                  >
                    <CartesianGrid />
                    <XAxis
                      dataKey="label"
                      tickFormatter={(d) =>
                        new Intl.DateTimeFormat(i18n.language || 'en-US', {
                          month: 'short',
                        }).format(new Date(d))
                      }
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line type="monotone" dataKey="invoiced" stroke="#0ea5e9" strokeWidth={2} />
                    <Line type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2} />
                    <Line type="monotone" dataKey="deposits" stroke="#f97316" strokeWidth={2} />
                  </LineChart>
                </ChartContainer>
                <div className="overflow-x-auto">
                  <table className="w-full table-fixed">
                    <thead>
                      <tr className="text-left">
                        <th className="p-2">{t('stats.month')}</th>
                        <th className="p-2 text-right">{t('stats.invoiced')}</th>
                        <th className="p-2 text-right">{t('stats.revenue')}</th>
                        <th className="p-2 text-right">{t('stats.deposits')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthsForCurrency.map((m) => (
                        <tr key={m.month}>
                          <td className="p-2">
                            {new Intl.DateTimeFormat(i18n.language || 'en-US', {
                              month: 'long',
                            }).format(new Date(year, m.month - 1, 1))}
                          </td>
                          <td className="p-2 text-right">
                            {formatCurrency(m.invoiced, selectedMonthlyCurrency)}
                          </td>
                          <td className="p-2 text-right">
                            {formatCurrency(m.revenue, selectedMonthlyCurrency)}
                          </td>
                          <td className="p-2 text-right">
                            {formatCurrency(m.deposits, selectedMonthlyCurrency)}
                          </td>
                        </tr>
                      ))}
                      {!monthsForCurrency.length && (
                        <tr>
                          <td colSpan={4} className="p-4 text-center text-muted-foreground">
                            {t('stats.noData')}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <label className="text-sm text-muted-foreground text-nowrap">
              {t('stats.controls.range')}
            </label>
            <YearPicker
              startYear={2000}
              endYear={new Date().getFullYear()}
              value={startYear}
              onChange={setStartYear}
            />
            <span>-</span>
            <YearPicker
              startYear={2000}
              endYear={new Date().getFullYear()}
              value={endYear}
              onChange={setEndYear}
            />
          </div>
          <div className="flex items-center space-x-2">
            {yearlyCurrencies.length ? (
              <Select
                value={selectedYearlyCurrency ?? undefined}
                onValueChange={(v: string) => setSelectedYearlyCurrency(v)}
              >
                <SelectTrigger size="sm">
                  <SelectValue placeholder={t('stats.controls.range')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {yearlyCurrencies.map((c) => (
                      <SelectItem key={c.currency} value={c.currency}>
                        {c.currency}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            ) : null}
          </div>
        </div>

        <Card>
          <CardContent>
            <div className="w-full space-y-4">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm text-muted-foreground">{t('stats.yearly.title')}</p>
                  <p className="text-2xl font-bold">
                    {selectedYearlyCurrency
                      ? formatCurrency(
                          yearsForCurrency.reduce((s, y) => s + y.revenue, 0),
                          selectedYearlyCurrency,
                        )
                      : '-'}
                  </p>
                </div>
              </div>
              <ChartContainer config={chartConfig} className="h-44 w-full">
                <LineChart
                  data={yearsChartData}
                  margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
                >
                  <CartesianGrid />
                  <XAxis
                    dataKey="label"
                    tickFormatter={(d) =>
                      new Intl.DateTimeFormat(i18n.language || 'en-US', { year: 'numeric' }).format(
                        new Date(d),
                      )
                    }
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line type="monotone" dataKey="invoiced" stroke="#0ea5e9" strokeWidth={2} />
                  <Line type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2} />
                  <Line type="monotone" dataKey="deposits" stroke="#f97316" strokeWidth={2} />
                </LineChart>
              </ChartContainer>
              <div className="overflow-x-auto">
                <table className="w-full table-fixed">
                  <thead>
                    <tr className="text-left">
                      <th className="p-2">{t('stats.year')}</th>
                      <th className="p-2 text-right">{t('stats.invoiced')}</th>
                      <th className="p-2 text-right">{t('stats.revenue')}</th>
                      <th className="p-2 text-right">{t('stats.deposits')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {yearsForCurrency.map((y) => (
                      <tr key={y.year}>
                        <td className="p-2">{y.year}</td>
                        <td className="p-2 text-right">
                          {formatCurrency(y.invoiced, selectedYearlyCurrency)}
                        </td>
                        <td className="p-2 text-right">
                          {formatCurrency(y.revenue, selectedYearlyCurrency)}
                        </td>
                        <td className="p-2 text-right">
                          {formatCurrency(y.deposits, selectedYearlyCurrency)}
                        </td>
                      </tr>
                    ))}
                    {!yearsForCurrency.length && (
                      <tr>
                        <td colSpan={4} className="p-4 text-center text-muted-foreground">
                          {t('stats.noData')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
