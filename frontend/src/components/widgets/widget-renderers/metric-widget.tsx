import { ChevronRight, Minus, TrendingDown, TrendingUp } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"

import { decimalsFor } from "@/components/documents/totals-calculator"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

import { buildMetricLinkHref } from "@/components/widgets/metric-link"
import { useWidgetReloading, WidgetValue } from "@/components/widgets/widget-value"
import { AmountBasisCaption } from "./amount-basis"
import type { MetricWidget } from "@/components/widgets/types"
import type { WidgetRendererProps } from "./registry"

// On a phone each figure is one row, label left and figure right, instead of a cramped pair of columns.
const TILE =
  "h-full gap-2 rounded-none border-0 py-5 shadow-[1px_0_0_var(--border),0_1px_0_var(--border)] max-sm:flex-row max-sm:items-start max-sm:justify-between max-sm:gap-4 max-sm:py-4"

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
        isUp ? "text-success-foreground" : "text-destructive-soft-foreground",
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

/** A single number and its label — "Pending invoices: 4", one cell of the figures panel: a
 *  sentence-case label, the figure in the figures face with tabular digits, and — when the contribution supplied
 *  `previousValue`, a variation chip underneath so a reader sees a direction, not just a number.
 *
 *  When the contribution supplied `link`, the whole tile opens the filtered list behind the figure
 *  (`short-list-widget.tsx`'s own `Link`-wrapped row is the precedent this follows): a visible hover
 *  affordance (border/background shift, a chevron that appears), a focus-visible ring for keyboard
 *  navigation, and a screen-reader-only "open the list" after the visible text, which stays the
 *  start of the link's name (WCAG 2.5.3). A metric with no `link` renders exactly as
 *  it did before this existed: a plain, non-interactive `Card`. */
export function MetricWidgetRenderer({ widget }: WidgetRendererProps) {
  const { t } = useTranslation()
  // Safe: this component is only ever registered for, and therefore only ever looked up under,
  // kind "metric" — see registry.ts's own comment on this trust boundary.
  const metric = widget as MetricWidget
  const reloading = useWidgetReloading()
  const tone = metricTone(metric.id, metric.label)

  const cardBody = (
    <>
      <CardHeader className="gap-0 px-5 max-sm:min-w-0 max-sm:flex-1 max-sm:pe-0">
        <CardTitle
          className={cn(
            "flex items-start justify-between gap-2 text-[13.5px] font-medium text-ink-2",
            tone === "destructive" && metric.value !== 0 && "font-semibold text-destructive-soft-foreground",
          )}
        >
          <span className="min-w-0">
            {tone === "destructive" && metric.value !== 0 && (
              <svg viewBox="0 0 12 12" aria-hidden="true" className="me-1.5 inline size-3 align-[-1px]">
                <path d="M6 1.5 11 10.5H1z" fill="currentColor" />
              </svg>
            )}
            {metric.label}
            <AmountBasisCaption
              basis={metric.basis}
              dataCy={`widget-${metric.id}-basis`}
              className="mt-0.5"
            />
          </span>
          {metric.link && (
            <ChevronRight
              className="mt-px size-3.5 shrink-0 text-muted-foreground/70 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5"
              aria-hidden="true"
            />
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 max-sm:shrink-0 max-sm:ps-0 max-sm:text-end">
        <WidgetValue>
          <p className="amount text-2xl leading-tight text-foreground sm:text-[34px]">
            {metric.approx ? "≈ " : ""}
            {metric.value.toLocaleString()}
            {metric.unit ? (
              <span className="ms-1 font-sans text-sm font-normal text-muted-foreground">{metric.unit}</span>
            ) : null}
          </p>
          {/* The chip's row is always reserved, so a tile without a chip is as tall as one with it.
              A current value of 0 never gets a chip: "0" next to "-100%" reads as a
              contradiction, whatever the contribution sends. */}
          <div className="mt-1.5 min-h-4" data-cy={`widget-${metric.id}-trend`}>
            {metric.previousValue !== undefined && metric.value !== 0 && (
              <VariationChip value={metric.value} previousValue={metric.previousValue} unit={metric.unit} />
            )}
          </div>
          {metric.warnings?.length ? (
            <ul className="mt-2 space-y-0.5" data-cy={`widget-${metric.id}-warnings`}>
              {metric.warnings.map((warning) => (
                <li key={warning} className="text-xs text-muted-foreground">
                  {warning}
                </li>
              ))}
            </ul>
          ) : null}
        </WidgetValue>
      </CardContent>
    </>
  )

  // A tile reloading for another period must not open the list of the previous one.
  if (metric.link && !reloading) {
    return (
      <Link
        to={buildMetricLinkHref(metric.link)}
        className="focus-ring group block h-full bg-card outline-none"
        data-cy={`widget-${metric.id}-link`}
      >
        <Card
          data-cy={`widget-${metric.id}`}
          data-widget-kind="metric"
          className={cn(TILE, "cursor-pointer transition-colors duration-150 hover:bg-sunken")}
        >
          {cardBody}
        </Card>
        <span className="sr-only">{t("widgets.metric.openListHint")}</span>
      </Link>
    )
  }

  return (
    <Card data-cy={`widget-${metric.id}`} data-widget-kind="metric" className={TILE}>
      {cardBody}
    </Card>
  )
}
