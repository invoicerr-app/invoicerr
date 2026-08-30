import { useTranslation } from "react-i18next"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

import type { TableWidget } from "@/components/widgets/types"
import type { WidgetRendererProps } from "./registry"

/** The "statistics c'est tout ultra détaillé" shape — every row a contribution decided to include,
 *  every column it decided to name. No sorting/filtering/pagination here: that is exactly the
 *  behavior document-list.tsx already gives every document TYPE's own saved records; this widget is
 *  a plain, honest table of whatever a contribution computed, nothing fancier assumed on top. */
export function TableWidgetRenderer({ widget }: WidgetRendererProps) {
  const { t } = useTranslation()
  const table = widget as TableWidget

  return (
    <Card className="col-span-full" data-cy={`widget-${table.id}`} data-widget-kind="table">
      <CardHeader className="pb-2">
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
                    <TableCell key={column.key}>{row[column.key] ?? "—"}</TableCell>
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
