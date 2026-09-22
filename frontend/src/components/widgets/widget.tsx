import { useTranslation } from "react-i18next"

// Side-effect only: registers the core widget-kind renderers — the same pattern
// field-renderers/index.ts already established for field kinds (see its own header comment).
import { getWidgetRenderer } from "@/components/widgets/widget-renderers"
import type { Widget as WidgetData } from "@/components/widgets/types"

interface WidgetProps {
  widget: WidgetData
}

/**
 * The one place a widget turns into UI: looks up a renderer by `kind` (never by document type — this
 * component, like every reader of a widget, has no idea which document type produced it) and
 * delegates entirely. An unregistered kind is shown, not hidden — this is what makes a document
 * type's contribution gap (the backend's "unimplemented" widget — see
 * contributions/collect-widgets.ts) and a genuinely unknown future `kind` both surface the exact same
 * way: a visible marker, never a widget that silently fails to appear next to the others.
 */
export function Widget({ widget }: WidgetProps) {
  const { t } = useTranslation()
  const Renderer = getWidgetRenderer(widget.kind)

  if (!Renderer) {
    return (
      <div
        className="rounded-md border border-dashed border-destructive/50 p-4 text-sm text-destructive"
        data-cy={`widget-${widget.id}-unsupported`}
      >
        {t("widgets.unsupportedKind", { label: widget.label, kind: widget.kind })}
      </div>
    )
  }

  return <Renderer widget={widget} />
}
