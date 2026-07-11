import { ArrowDown, ArrowUp } from "lucide-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { TableFilterBar, TableSearchFilter } from "@/components/table-filter-bar"
import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { getDisplayInvoiceStatus } from "@/types"
import { useClientSearch, useInvoicesTable } from "@/hooks/queries"
import { useTableExport } from "@/hooks/use-table-export"
import { useTranslation } from "react-i18next"

export function InvoiceTable() {
  const { t } = useTranslation()

  const [clientId, setClientId] = useState<string | undefined>(undefined)
  const [clientSearchTerm, setClientSearchTerm] = useState("")
  const [year, setYear] = useState<number | undefined>(undefined)
  const [month, setMonth] = useState<number | undefined>(undefined)
  const [sort, setSort] = useState<"asc" | "desc">("desc")

  const { data: clientOptions } = useClientSearch(clientSearchTerm)
  const { data: invoices, isLoading } = useInvoicesTable({ clientId, year, month, sort })
  const rows = invoices ?? []

  const getStatusLabel = (status: string) =>
    t(`invoices.list.status.${getDisplayInvoiceStatus(status).toLowerCase()}`)

  const { handleExport } = useTableExport(
    rows,
    [
      {
        header: t("invoices.table.columns.number"),
        cell: (invoice) => invoice.rawNumber || (invoice.number?.toString() ?? ""),
      },
      { header: t("invoices.table.columns.client"), cell: (invoice) => invoice.client?.name || "" },
      { header: t("invoices.table.columns.status"), cell: (invoice) => getStatusLabel(invoice.status) },
      { header: t("invoices.table.columns.totalTTC"), cell: (invoice) => invoice.totalTTC.toFixed(2) },
      {
        header: t("invoices.table.columns.createdAt"),
        cell: (invoice) => new Date(invoice.createdAt).toLocaleDateString(),
      },
      {
        header: t("invoices.table.columns.dueDate"),
        cell: (invoice) => (invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : ""),
      },
    ],
    "invoices.csv",
  )

  return (
    <Card className="gap-0">
      <CardContent className="p-4 sm:p-6 space-y-4">
        <TableFilterBar
          translationPrefix="invoices"
          year={year}
          onYearChange={setYear}
          month={month}
          onMonthChange={setMonth}
          onExport={handleExport}
          exportDisabled={rows.length === 0}
        >
          <TableSearchFilter
            label={t("invoices.table.filters.client")}
            options={(clientOptions ?? []).map((client) => ({
              label: client.name || `${client.contactFirstname} ${client.contactLastname}`,
              value: client.id,
            }))}
            value={clientId}
            onValueChange={setClientId}
            onSearchChange={setClientSearchTerm}
            placeholder={t("invoices.table.filters.clientPlaceholder")}
            noResultsText={t("invoices.table.filters.clientNoResults")}
            dataCy="invoice-table-client-filter"
          />
        </TableFilterBar>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner className="h-8 w-8" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12">{t("invoices.table.emptyState")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("invoices.table.columns.number")}</TableHead>
                <TableHead>{t("invoices.table.columns.client")}</TableHead>
                <TableHead>{t("invoices.table.columns.status")}</TableHead>
                <TableHead>{t("invoices.table.columns.totalTTC")}</TableHead>
                <TableHead>
                  <button
                    type="button"
                    className="flex items-center gap-1"
                    onClick={() => setSort((s) => (s === "asc" ? "desc" : "asc"))}
                  >
                    {t("invoices.table.columns.createdAt")}
                    {sort === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                  </button>
                </TableHead>
                <TableHead>{t("invoices.table.columns.dueDate")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell>{invoice.rawNumber || invoice.number}</TableCell>
                  <TableCell>{invoice.client?.name || ""}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{getStatusLabel(invoice.status)}</Badge>
                  </TableCell>
                  <TableCell>
                    {t("common.valueWithCurrency", {
                      currency: invoice.currency || "",
                      amount: invoice.totalTTC.toFixed(2),
                    })}
                  </TableCell>
                  <TableCell>{new Date(invoice.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell>
                    {invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : ""}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
