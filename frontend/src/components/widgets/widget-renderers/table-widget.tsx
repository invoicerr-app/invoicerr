import { useTranslation } from "react-i18next"

import { DocumentStatusBadge } from "@/components/documents/document-status-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

import type { TableWidget } from "@/components/widgets/types"
import type { WidgetRendererProps } from "./registry"

/** One cell — a `status` column reads through the SAME badge every document list already shows for
 *  the exact same status (never a plain lowercase word next to the colored badge the list uses for
 *  that same fact), a number is right-aligned in the mono tabular face, everything else is plain
 *  text. A column key is a naming convention a contribution controls, not a document type — this
 *  never branches on which type built the table. */
function TableCellValue({ columnKey, value }: { columnKey: string; value: string | number | undefined }) {
  if (value === undefined || value === null || value === "") return <span>—</span>
  if (columnKey === "status" && typeof value === "string") {
    return <DocumentStatusBadge status={value} />
  }
  if (typeof value === "number") {
    return <span className="amount tabular-nums">{value.toLocaleString()}</span>
  }
  return <span>{value}</span>
}

/** The "statistics, all of it, in full detail" shape — every row a contribution decided to include,
 *  every column it decided to name. No sorting/filtering/pagination here: that is exactly the
 *  behavior document-list.tsx already gives every document TYPE's own saved records; this widget is
 *  a plain, honest table of whatever a contribution computed, nothing fancier assumed on top. */
export function TableWidgetRenderer({ widget }: WidgetRendererProps) {
  const { t } = useTranslation()
  const table = widget as TableWidget

  return (
    <Card className="col-span-full gap-0" data-cy={`widget-${table.id}`} data-widget-kind="table">
      <CardHeader className="border-b">
        <CardTitle className="text-sm font-medium text-muted-foreground">{table.label}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        {table.rows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t("widgets.table.empty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {table.columns.map((column) => (
                  <TableHead key={column.key}>{column.label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {table.rows.map((row, index) => (
                // Rows are a plain computed list with no id of their own — position is all there is,
                // the same discipline field-value.tsx's 'array' case documents for the same reason.
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are structural, not identified
                <TableRow key={index}>
                  {table.columns.map((column) => (
                    <TableCell key={column.key}>
                      <TableCellValue columnKey={column.key} value={row[column.key]} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
