import { Area, AreaChart, CartesianGrid, XAxis } from "recharts"
import { DocumentTypeIcon } from "@/components/documents/document-type-icon"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"

import type { TimeSeriesWidget } from "@/components/widgets/types"
import { WidgetValue } from "@/components/widgets/widget-value"
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
        <CardTitle className="font-heading text-xl font-normal text-foreground">
          <DocumentTypeIcon icon={series.icon} className="me-2 inline align-[-1px] text-muted-foreground" />
          {series.label}
        </CardTitle>
        <WidgetValue>
          <p className="amount mt-1 text-[34px] leading-tight text-foreground">
            {total.toLocaleString()}
            {series.unit ? (
              <span className="ms-1 text-sm font-normal text-muted-foreground">{series.unit}</span>
            ) : null}
          </p>
        </WidgetValue>
      </CardHeader>
      <CardContent>
        <WidgetValue>
          <ChartContainer config={CHART_CONFIG} className="aspect-auto h-48 w-full">
            <AreaChart data={series.points} margin={{ left: 8, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Area
                dataKey="value"
                type="linear"
                stroke="var(--color-value)"
                strokeWidth={2}
                fill="var(--color-value)"
                fillOpacity={0.14}
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ChartContainer>
        </WidgetValue>
      </CardContent>
    </Card>
  )
}
