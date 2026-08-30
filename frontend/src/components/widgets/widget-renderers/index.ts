import { MetricWidgetRenderer } from "./metric-widget"
import { registerWidgetRenderer } from "./registry"
import { ShortListWidgetRenderer } from "./short-list-widget"
import { TableWidgetRenderer } from "./table-widget"
import { TimeSeriesWidgetRenderer } from "./time-series-widget"

/**
 * Registers the closed core set of widget-kind renderers. Importing this module is what makes the
 * core kinds renderable — widget.tsx imports it once, for the side effect, before any Widget is
 * rendered (the same pattern components/documents/field-renderers/index.ts already established for
 * field kinds).
 *
 * Deliberately NEVER registers "unimplemented": that kind is emitted only by the backend's own
 * collect-widgets.ts when a document type declares a contribution nobody implemented — leaving it
 * unregistered here is precisely what makes it fall through to the exact same generic fallback
 * marker any other unrecognized `kind` would (see widget.tsx). Registering a real component for it
 * would defeat the point: a missing implementation must look exactly as visible as a widget kind
 * this frontend build has simply never heard of, never something smoothed over with its own polish.
 *
 * TO ADD A WIDGET KIND: write one component matching WidgetRendererProps (widget-renderers/registry.ts)
 * and call `registerWidgetRenderer("yourKind", YourComponent)` here — nothing else (widget.tsx, the
 * dashboard/statistics pages) changes.
 */
registerWidgetRenderer("metric", MetricWidgetRenderer)
registerWidgetRenderer("timeSeries", TimeSeriesWidgetRenderer)
registerWidgetRenderer("shortList", ShortListWidgetRenderer)
registerWidgetRenderer("table", TableWidgetRenderer)

export { getWidgetRenderer, registerWidgetRenderer } from "./registry"
export type { WidgetRendererComponent, WidgetRendererProps } from "./registry"
