import type { ComponentType } from "react"

import type { Widget } from "@/components/widgets/types"

export interface WidgetRendererProps {
  widget: Widget
}

export type WidgetRendererComponent = ComponentType<WidgetRendererProps>

/**
 * Open registry of widget-KIND renderers, keyed by `kind` — the dashboard/statistics counterpart to
 * components/documents/field-renderers/registry.ts: this is the entire reason the generic Widget
 * component (../widget.tsx) never has a switch on the document TYPE that produced a widget, or even
 * on a fixed list of kinds. It only ever asks "who renders this KIND". Every registered component
 * receives the full `Widget` union and narrows to its own shape internally (a plain cast, safe
 * because a component is only ever registered — and therefore only ever looked up — for the one
 * `kind` it knows how to draw), the same trust boundary `getFieldRenderer` already keeps for fields.
 *
 * Deliberately never gets an entry for "unimplemented" (see widget-renderers/index.ts's own comment)
 * — that, and any other `kind` a future backend might send that this build has never heard of, falls
 * through `getWidgetRenderer` returning undefined, exactly the same as an unregistered field KIND
 * does for DocumentField.
 */
const WIDGET_RENDERERS = new Map<string, WidgetRendererComponent>()

export function registerWidgetRenderer(kind: string, component: WidgetRendererComponent): void {
  WIDGET_RENDERERS.set(kind, component)
}

export function getWidgetRenderer(kind: string): WidgetRendererComponent | undefined {
  return WIDGET_RENDERERS.get(kind)
}
