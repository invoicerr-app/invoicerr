import { CartesianGrid, Line, LineChart, XAxis } from "recharts"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"

import type { TimeSeriesWidget } from "@/components/widgets/types"
import type { WidgetRendererProps } from "./registry"

const CHART_CONFIG: ChartConfig = {
  value: { label: "Value", color: "var(--chart-1)" },
}

/** The curve — "pending invoices" gets its own kind (shortList); this is "the invoices
 *  curve". recharts (already a dependency, see components/ui/chart.tsx) is enough on its own:
 *  no new package needed for this widget. The card leads with the SUM of every point — the one
 *  number a reader would otherwise have to add up themselves off the curve — next to the title,
 *  the same "title + total + graph" shape every chart card in this app now follows. */
export function TimeSeriesWidgetRenderer({ widget }: WidgetRendererProps) {
  const series = widget as TimeSeriesWidget
  const total = series.points.reduce((sum, point) => sum + point.value, 0)

  return (
    <Card data-cy={`widget-${series.id}`} data-widget-kind="timeSeries">
      <CardHeader className="gap-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{series.label}</CardTitle>
        <p className="amount text-xl font-semibold text-foreground">
          {total.toLocaleString()}
          {series.unit ? (
            <span className="ml-1 text-sm font-normal text-muted-foreground">{series.unit}</span>
          ) : null}
        </p>
      </CardHeader>
      <CardContent>
        <ChartContainer config={CHART_CONFIG} className="aspect-auto h-48 w-full">
          <LineChart data={series.points} margin={{ left: 8, right: 8 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Line
              dataKey="value"
              type="monotone"
              stroke="var(--color-value)"
              strokeWidth={2}
              dot={{ r: 3, fill: "var(--color-value)", strokeWidth: 0 }}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
