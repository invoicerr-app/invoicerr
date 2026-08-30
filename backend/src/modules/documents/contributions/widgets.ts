import { WidgetLocation } from '../descriptors/types';

/**
 * The WIDGET vocabulary a document type's contribution renders into — the aggregation-screen
 * counterpart to DocumentFieldDescriptor's field KINDS (descriptors/field-kinds.ts): a small, closed
 * set of SHAPES the frontend knows how to draw, never anything that names a document type. A
 * contribution returns instances of this union; the frontend looks a widget up by `kind`, exactly
 * the way DocumentField looks a field up by `field.kind`.
 *
 * Deliberately small at first — only the four shapes actually asked for (a number, a curve, a short
 * list, a detailed table) — because an unused fifth shape would be exactly the kind of speculative
 * vocabulary this codebase avoids elsewhere (see invoice.descriptor.ts's "deliberately NOT added"
 * section for the same discipline applied to fields). Add a new `kind` only once a real contribution
 * needs it, on both sides (this file, and the matching renderer in
 * frontend/src/components/widgets/widget-renderers/).
 */
export interface WidgetBase {
  /** Stable within one collectWidgets() response — used as the React key and, for a "shortList"
   *  item, `id` plays the same role one level down. Not guaranteed unique ACROSS locations or
   *  companies, only within one response. */
  id: string;
  /** Human-facing, plain data — same convention as DocumentTypeDescriptor.label, not an i18n key: a
   *  plugin's widget can be labelled in any language. */
  label: string;
}

/** A single number and its label — "Pending invoices: 4", "This month's expenses: 128.00 EUR". */
export interface MetricWidget extends WidgetBase {
  kind: 'metric';
  value: number;
  /** Optional plain-text suffix — a currency code, a unit — shown after `value`. Never a computed
   *  currency CONVERSION, only a label for whatever `value` already is. */
  unit?: string;
}

export interface TimeSeriesPoint {
  /** Plain text — e.g. "Jan 26" — not a machine-parseable date, since nothing downstream needs to
   *  re-derive one; the contribution already chose the bucketing (month, week, ...). */
  label: string;
  value: number;
}

/** A curve over time — "Invoices issued per month". */
export interface TimeSeriesWidget extends WidgetBase {
  kind: 'timeSeries';
  points: TimeSeriesPoint[];
  unit?: string;
}

export interface ShortListItem {
  /** Stable id of the underlying record (e.g. a document instance id) — lets the frontend key rows
   *  without inventing an index, and gives a future "click through" something real to navigate to. */
  id: string;
  primary: string;
  /** Optional second line — e.g. a due date, a status. */
  secondary?: string;
}

/** A short, unpaginated list — "Pending invoices": the handful a dashboard glance needs, not the
 *  paginated table a Statistics screen wants (see TableWidget for that). */
export interface ShortListWidget extends WidgetBase {
  kind: 'shortList';
  items: ShortListItem[];
}

export interface TableColumn {
  key: string;
  label: string;
}

/** A fully detailed table — the "statistics c'est tout ultra détaillé" shape. `rows` are plain
 *  key/value records keyed by `columns[].key`; a contribution decides its own columns, the same way
 *  a document type decides its own fields — this widget never infers columns from anywhere else. */
export interface TableWidget extends WidgetBase {
  kind: 'table';
  columns: TableColumn[];
  rows: Record<string, string | number>[];
}

/**
 * Emitted ONLY by collectWidgets() itself (contributions/collect-widgets.ts) — never returned by a
 * real contribution handler — when a document type DECLARES a contribution for a location but no
 * handler is REGISTERED for it. `kind: 'unimplemented'` is deliberately a value the frontend's widget
 * renderer registry never registers a component for (see
 * frontend/src/components/widgets/widget-renderers/index.ts's own comment): this makes a missing
 * implementation fall through the exact same "unknown widget kind -> explicit marker" path a
 * genuinely foreign `kind` would, the same way DocumentField never special-cases "no renderer" versus
 * "renderer not written yet" — both cases are, and must stay, VISIBLE, never a silent gap that reads
 * as "nothing to show here".
 */
export interface UnimplementedContributionWidget extends WidgetBase {
  kind: 'unimplemented';
  typeId: string;
  location: WidgetLocation;
}

export type Widget =
  | MetricWidget
  | TimeSeriesWidget
  | ShortListWidget
  | TableWidget
  | UnimplementedContributionWidget;

export function unimplementedContributionWidget(
  typeId: string,
  location: WidgetLocation,
  label: string,
): UnimplementedContributionWidget {
  return { id: `${typeId}:${location}:unimplemented`, kind: 'unimplemented', label, typeId, location };
}
