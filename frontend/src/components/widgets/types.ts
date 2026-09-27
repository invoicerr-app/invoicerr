// Mirrors backend/src/modules/documents/contributions/widgets.ts. Deliberately duplicated rather
// than shared — same convention as components/documents/types.ts mirroring the backend's descriptor
// shapes: a wire shape, not code, and front/back are two separate npm projects with no shared package.

export interface WidgetBase {
  id: string
  label: string
  /** Plain-English caveats about THIS widget's own numbers — e.g. the exchange rate(s) a currency
   *  consolidation used, or which currency was missing one. Always shown, never thrown. */
  warnings?: string[]
}

/**
 * Where a metric's tile links to when clicked: a LIST destination, not a URL. Mirrors the backend's
 * own `MetricWidgetLink` (contributions/widgets.ts) exactly: absent means this metric has no list
 * whose rows are precisely what the figure aggregates over, so the tile renders exactly as it always
 * has, with no link at all (see metric-link.ts's own `buildMetricLinkHref`, which turns this into the
 * `/documents/:typeId` URL).
 */
export interface MetricWidgetLink {
  typeId: string
  status?: string[]
  /** `YYYY-MM-DD`, inclusive, matching `/documents/:typeId`'s own `dateFrom`/`dateTo` query params. */
  dateFrom?: string
  dateTo?: string
  settlement?: "unsettled" | "overdue"
}

export interface MetricWidget extends WidgetBase {
  kind: "metric"
  value: number
  unit?: string
  /** See `MetricWidgetLink`'s own header: absent on a metric with no exactly-matching list. */
  link?: MetricWidgetLink
  /** Marks `value` as a currency-converted APPROXIMATION rather than an original, exact document
   *  amount — the renderer prefixes it with "≈". See backend's widgets.ts for the full contract. */
  approx?: boolean
  /** The same figure for the period immediately preceding the one `value` covers — renders as a
   *  variation chip (arrow + percentage, or an absolute delta when there was nothing to compare a
   *  percentage against). Absent on a STOCK metric (a running total, a plain count), which has no
   *  previous period at all — see backend's widgets.ts for the full contract. */
  previousValue?: number
}

export interface TimeSeriesPoint {
  label: string
  value: number
}

export interface TimeSeriesWidget extends WidgetBase {
  kind: "timeSeries"
  points: TimeSeriesPoint[]
  unit?: string
}

export interface ShortListItem {
  id: string
  primary: string
  secondary?: string
  /** The record's own status id — rendered through the same `DocumentStatusBadge` every document
   *  list already uses, so a status looks identical whichever screen it is read on. */
  status?: string
  /** ISO date (YYYY-MM-DD) the record was expected to be settled by — lets the row flag itself as
   *  overdue against today's date. */
  dueDate?: string
  /** The record's own figure in its OWN currency, right-aligned in the mono face — never a
   *  converted or summed figure. */
  amount?: { value: number; currency: string }
}

export interface ShortListWidget extends WidgetBase {
  kind: "shortList"
  items: ShortListItem[]
  /** The document type every item is an instance of, when they all are one — lets the row link to
   *  `/documents/<documentTypeId>/<item.id>`. Absent on a list whose items are not documents. */
  documentTypeId?: string
}

export interface TableColumn {
  key: string
  label: string
}

export interface TableWidget extends WidgetBase {
  kind: "table"
  columns: TableColumn[]
  rows: Record<string, string | number>[]
}

/**
 * A widget whose `kind` this frontend build does not (or, for "unimplemented", deliberately never
 * will) have a renderer for — see widget-renderers/registry.ts's `getWidgetRenderer`. Not a real
 * backend shape: it is what any OTHER widget shape looks like from here, once narrowed down to the
 * two fields every widget is guaranteed to have (WidgetBase). Kept broad (`kind: string`, everything
 * else optional/unknown) so a genuinely future backend `kind` this build has never heard of still
 * renders its fallback marker instead of a TypeScript mismatch.
 */
export interface UnknownWidget extends WidgetBase {
  kind: string
  [key: string]: unknown
}

export type Widget = MetricWidget | TimeSeriesWidget | ShortListWidget | TableWidget | UnknownWidget
