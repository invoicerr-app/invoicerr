import { useTranslation } from "react-i18next"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

import type { ShortListWidget } from "@/components/widgets/types"
import type { WidgetRendererProps } from "./registry"

/** A short, unpaginated list — "les factures en attente". Deliberately no pagination, no search: a
 *  dashboard glance, not the detailed table (see table-widget.tsx) statistics gets. */
export function ShortListWidgetRenderer({ widget }: WidgetRendererProps) {
  const { t } = useTranslation()
  const shortList = widget as ShortListWidget

  return (
    <Card data-cy={`widget-${shortList.id}`} data-widget-kind="shortList">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{shortList.label}</CardTitle>
      </CardHeader>
      <CardContent>
        {shortList.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("widgets.shortList.empty")}</p>
        ) : (
          <ul className="space-y-2" data-cy={`widget-${shortList.id}-items`}>
            {shortList.items.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 border-b pb-2 text-sm last:border-0 last:pb-0"
              >
                <span className="font-medium">{item.primary}</span>
                {item.secondary && <span className="text-muted-foreground">{item.secondary}</span>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
