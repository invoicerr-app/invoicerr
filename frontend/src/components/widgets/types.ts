// Mirrors backend/src/modules/documents/contributions/widgets.ts. Deliberately duplicated rather
// than shared — same convention as components/documents/types.ts mirroring the backend's descriptor
// shapes: a wire shape, not code, and front/back are two separate npm projects with no shared package.

export interface WidgetBase {
  id: string
  label: string
}

export interface MetricWidget extends WidgetBase {
  kind: "metric"
  value: number
  unit?: string
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
}

export interface ShortListWidget extends WidgetBase {
  kind: "shortList"
  items: ShortListItem[]
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
