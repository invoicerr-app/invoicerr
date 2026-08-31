import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

import type { MetricWidget } from "@/components/widgets/types"
import type { WidgetRendererProps } from "./registry"

/** A single number and its label — "Pending invoices: 4". The simplest widget kind: no chart, no
 *  list, just a card. */
export function MetricWidgetRenderer({ widget }: WidgetRendererProps) {
  // Safe: this component is only ever registered for, and therefore only ever looked up under,
  // kind "metric" — see registry.ts's own comment on this trust boundary.
  const metric = widget as MetricWidget

  return (
    <Card data-cy={`widget-${metric.id}`} data-widget-kind="metric">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{metric.label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold tabular-nums">
          {metric.approx ? "≈ " : ""}
          {metric.value.toLocaleString()}
          {metric.unit ? (
            <span className="ml-1 text-base font-normal text-muted-foreground">{metric.unit}</span>
          ) : null}
        </p>
        {metric.warnings?.length ? (
          <ul className="mt-2 space-y-0.5" data-cy={`widget-${metric.id}-warnings`}>
            {metric.warnings.map((warning) => (
              <li key={warning} className="text-xs text-muted-foreground">
                {warning}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  )
}
