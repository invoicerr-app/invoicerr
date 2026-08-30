import { CartesianGrid, Line, LineChart, XAxis } from "recharts"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"

import type { TimeSeriesWidget } from "@/components/widgets/types"
import type { WidgetRendererProps } from "./registry"

const CHART_CONFIG: ChartConfig = {
  value: { label: "Value", color: "var(--chart-1)" },
}

/** The curve — "les factures en attente" gets its own kind (shortList); this is "la courbe des
 *  factures". recharts (already a dependency, see components/ui/chart.tsx) is enough on its own:
 *  no new package needed for this widget. */
export function TimeSeriesWidgetRenderer({ widget }: WidgetRendererProps) {
  const series = widget as TimeSeriesWidget

  return (
    <Card data-cy={`widget-${series.id}`} data-widget-kind="timeSeries">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{series.label}</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={CHART_CONFIG} className="aspect-auto h-48 w-full">
          <LineChart data={series.points} margin={{ left: 8, right: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Line dataKey="value" type="monotone" stroke="var(--color-value)" strokeWidth={2} dot={false} />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
