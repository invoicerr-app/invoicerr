import { useTranslation } from "react-i18next"
import { Link } from "react-router"

import { decimalsFor } from "@/components/documents/totals-calculator"
import { DocumentStatusBadge } from "@/components/documents/document-status-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

import type { ShortListItem, ShortListWidget } from "@/components/widgets/types"
import type { WidgetRendererProps } from "./registry"

/** Today, as an ISO date-only string — the same UTC-midnight comparison the backend's own overdue
 *  arithmetic uses (invoice-contributions.ts), so a row never disagrees with the total it came from. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

interface ShortListRowProps {
  item: ShortListItem
  documentTypeId?: string
}

/** One row — the same facts a document-list.tsx row leads with: a status badge, the title, a
 *  right-aligned amount in the mono face. A `dueDate` already in the past is called out in the
 *  destructive tone, the same "never hide, never invent a rule the reader can't see" discipline the
 *  status badge itself holds. Opens the record when `documentTypeId` names one; a list whose items
 *  are not documents (none exist yet, but the shape allows it) stays plain text. */
function ShortListRow({ item, documentTypeId }: ShortListRowProps) {
  const overdue = !!item.dueDate && item.dueDate.slice(0, 10) < todayIso()

  const content = (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        {item.status && <DocumentStatusBadge status={item.status} />}
        <span className="min-w-0 truncate font-medium text-foreground">{item.primary}</span>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {item.secondary && (
          <span className={cn("text-xs", overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
            {item.secondary}
          </span>
        )}
        {item.amount && (
          <span className="amount text-sm font-medium text-foreground">
            {item.amount.value.toFixed(decimalsFor(item.amount.currency))} {item.amount.currency}
          </span>
        )}
      </div>
    </div>
  )

  const rowClassName = "block rounded-md px-1 py-1.5 -mx-1 text-sm transition-colors duration-150"

  if (documentTypeId) {
    return (
      <Link
        to={`/documents/${documentTypeId}/${item.id}`}
        className={cn(rowClassName, "hover:bg-accent/40 focus-visible:bg-accent/40 outline-none")}
        data-cy={`widget-item-${item.id}`}
      >
        {content}
      </Link>
    )
  }

  return (
    <div className={rowClassName} data-cy={`widget-item-${item.id}`}>
      {content}
    </div>
  )
}

/** A short, unpaginated list — "pending invoices". Deliberately no pagination, no search: a
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
          <ul className="divide-y" data-cy={`widget-${shortList.id}-items`}>
            {shortList.items.map((item) => (
              <li key={item.id}>
                <ShortListRow item={item} documentTypeId={shortList.documentTypeId} />
              </li>
            ))}
          </ul>
        )}
        {/* Same "always shown, never thrown" convention as the metric renderer's own warnings list
            (metric-widget.tsx) - e.g. the dashboard's active period not applying to this particular
            list (schedules/schedule-widgets.ts's "upcoming recurrences"). */}
        {shortList.warnings?.length ? (
          <ul className="mt-2 space-y-0.5" data-cy={`widget-${shortList.id}-warnings`}>
            {shortList.warnings.map((warning) => (
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
