import { Minus, TrendingDown, TrendingUp } from "lucide-react"
import { useTranslation } from "react-i18next"

import { decimalsFor } from "@/components/documents/totals-calculator"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

import type { MetricWidget } from "@/components/widgets/types"
import type { WidgetRendererProps } from "./registry"

type Tone = "neutral" | "info" | "success" | "warning" | "destructive"

// The same "match a small, generic vocabulary in the widget's own words, never a document type"
// discipline `document-status-badge.tsx#toneOf` already holds for a status STRING — applied here to
// a metric's id/label instead, since a metric widget carries no `status` of its own. Kept
// deliberately narrow (only the words the current contributions actually use) rather than guessing
// at every possible future label: a metric that matches nothing stays neutral, never miscolored.
const TONE_PATTERNS: [Tone, RegExp][] = [
  ["destructive", /overdue|reject|fail|error|late/i],
  ["warning", /pending|awaiting|outstanding/i],
  ["info", /open|draft/i],
  ["success", /paid|settled|complete/i],
]

function metricTone(id: string, label: string): Tone {
  const haystack = `${id} ${label}`
  for (const [tone, pattern] of TONE_PATTERNS) {
    if (pattern.test(haystack)) return tone
  }
  return "neutral"
}

// A left accent stripe, not a filled background — "sober tile" per the identity brief: the shape
// (a stripe) and the color both carry the signal, without the tile shouting. `border-l-transparent`
// keeps the ordinary, unremarkable case (a plain count or flow) visually silent.
const TONE_BORDER: Record<Tone, string> = {
  neutral: "border-l-transparent",
  info: "border-l-info",
  success: "border-l-success",
  warning: "border-l-warning",
  destructive: "border-l-destructive",
}

interface VariationChipProps {
  value: number
  previousValue: number
  unit?: string
}

/** "+12% vs previous period" — arrow shape AND color both encode the direction (never color alone),
 *  the same "form + semantic color" rule the KPI tile's own accent stripe follows. Falls back to an
 *  absolute delta when `previousValue` is 0 (a percentage against zero is undefined, not "+∞%"). */
function VariationChip({ value, previousValue, unit }: VariationChipProps) {
  const { t } = useTranslation()
  const diff = value - previousValue

  if (diff === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="size-3" aria-hidden="true" />
        {t("widgets.metric.unchanged")}
      </span>
    )
  }

  const isUp = diff > 0
  const decimals = unit ? decimalsFor(unit) : 2
  const label =
    previousValue !== 0
      ? t("widgets.metric.variationPercent", {
          sign: isUp ? "+" : "",
          percent: ((diff / previousValue) * 100).toFixed(0),
        })
      : t("widgets.metric.variationAbsolute", {
          sign: isUp ? "+" : "",
          value: diff.toFixed(decimals),
          unit: unit ?? "",
        })

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium",
        // `--success` itself is the pale FILL a badge sits on (document-status-badge.tsx's own
        // convention) — its `-foreground` is the readable ink meant to sit on a neutral card
        // background in both themes. `--destructive` has no such split (it IS the plain-text-safe
        // tone already, see document-list.tsx's own `text-destructive` on a row's own error line).
        isUp ? "text-success-foreground" : "text-destructive",
      )}
    >
      {isUp ? (
        <TrendingUp className="size-3" aria-hidden="true" />
      ) : (
        <TrendingDown className="size-3" aria-hidden="true" />
      )}
      {label}
    </span>
  )
}

/** A single number and its label — "Pending invoices: 4", now a KPI tile: label in the small-caps
 *  treatment every section title in this app uses, the figure itself in the mono tabular face
 *  (identity "Lagune" — a column of these never jitters), and — when the contribution supplied
 *  `previousValue` — a variation chip underneath so a reader sees a direction, not just a number. */
export function MetricWidgetRenderer({ widget }: WidgetRendererProps) {
  // Safe: this component is only ever registered for, and therefore only ever looked up under,
  // kind "metric" — see registry.ts's own comment on this trust boundary.
  const metric = widget as MetricWidget
  const tone = metricTone(metric.id, metric.label)

  return (
    <Card
      data-cy={`widget-${metric.id}`}
      data-widget-kind="metric"
      className={cn("gap-2 border-l-4 py-4", TONE_BORDER[tone])}
    >
      <CardHeader className="gap-0 px-4">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {metric.label}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <p className="amount text-2xl font-semibold text-foreground sm:text-3xl">
          {metric.approx ? "≈ " : ""}
          {metric.value.toLocaleString()}
          {metric.unit ? (
            <span className="ml-1 text-sm font-normal text-muted-foreground">{metric.unit}</span>
          ) : null}
        </p>
        {metric.previousValue !== undefined && (
          <div className="mt-1.5">
            <VariationChip value={metric.value} previousValue={metric.previousValue} unit={metric.unit} />
          </div>
        )}
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
