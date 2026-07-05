import { ArrowDown, ArrowUp } from "lucide-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { TableFilterBar, TableSearchFilter } from "@/components/table-filter-bar"
import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { useClientSearch, useQuotesTable } from "@/hooks/queries"
import { useTableExport } from "@/hooks/use-table-export"
import { useTranslation } from "react-i18next"

export function QuoteTable() {
    const { t } = useTranslation()

    const [clientId, setClientId] = useState<string | undefined>(undefined)
    const [clientSearchTerm, setClientSearchTerm] = useState("")
    const [year, setYear] = useState<number | undefined>(undefined)
    const [month, setMonth] = useState<number | undefined>(undefined)
    const [sort, setSort] = useState<"asc" | "desc">("desc")

    const { data: clientOptions } = useClientSearch(clientSearchTerm)
    const { data: quotes, isLoading } = useQuotesTable({ clientId, year, month, sort })
    const rows = quotes ?? []

    const getStatusLabel = (status: string) => t(`quotes.list.status.${status.toLowerCase()}`)

    const { handleExport } = useTableExport(rows, [
        { header: t("quotes.table.columns.number"), cell: (quote) => quote.rawNumber || (quote.number?.toString() ?? "") },
        { header: t("quotes.table.columns.client"), cell: (quote) => quote.client?.name || "" },
        { header: t("quotes.table.columns.status"), cell: (quote) => getStatusLabel(quote.status) },
        { header: t("quotes.table.columns.totalTTC"), cell: (quote) => quote.totalTTC.toFixed(2) },
        { header: t("quotes.table.columns.createdAt"), cell: (quote) => new Date(quote.createdAt).toLocaleDateString() },
        { header: t("quotes.table.columns.validUntil"), cell: (quote) => quote.validUntil ? new Date(quote.validUntil).toLocaleDateString() : "" },
    ], "quotes.csv")

    return (
        <Card className="gap-0">
            <CardContent className="p-4 sm:p-6 space-y-4">
                <TableFilterBar
                    translationPrefix="quotes"
                    year={year}
                    onYearChange={setYear}
                    month={month}
                    onMonthChange={setMonth}
                    onExport={handleExport}
                    exportDisabled={rows.length === 0}
                >
                    <TableSearchFilter
                        label={t("quotes.table.filters.client")}
                        options={(clientOptions ?? []).map((client) => ({
                            label: client.name || `${client.contactFirstname} ${client.contactLastname}`,
                            value: client.id,
                        }))}
                        value={clientId}
                        onValueChange={setClientId}
                        onSearchChange={setClientSearchTerm}
                        placeholder={t("quotes.table.filters.clientPlaceholder")}
                        noResultsText={t("quotes.table.filters.clientNoResults")}
                        dataCy="quote-table-client-filter"
                    />
                </TableFilterBar>

                {isLoading ? (
                    <div className="flex items-center justify-center py-12">
                        <Spinner className="h-8 w-8" />
                    </div>
                ) : rows.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-12">{t("quotes.table.emptyState")}</p>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>{t("quotes.table.columns.number")}</TableHead>
                                <TableHead>{t("quotes.table.columns.client")}</TableHead>
                                <TableHead>{t("quotes.table.columns.status")}</TableHead>
                                <TableHead>{t("quotes.table.columns.totalTTC")}</TableHead>
                                <TableHead>
                                    <button
                                        type="button"
                                        className="flex items-center gap-1"
                                        onClick={() => setSort((s) => (s === "asc" ? "desc" : "asc"))}
                                    >
                                        {t("quotes.table.columns.createdAt")}
                                        {sort === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                                    </button>
                                </TableHead>
                                <TableHead>{t("quotes.table.columns.validUntil")}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows.map((quote) => (
                                <TableRow key={quote.id}>
                                    <TableCell>{quote.rawNumber || quote.number}</TableCell>
                                    <TableCell>{quote.client?.name || ""}</TableCell>
                                    <TableCell>
                                        <Badge variant="outline">{getStatusLabel(quote.status)}</Badge>
                                    </TableCell>
                                    <TableCell>
                                        {t("common.valueWithCurrency", {
                                            currency: quote.currency || "",
                                            amount: quote.totalTTC.toFixed(2),
                                        })}
                                    </TableCell>
                                    <TableCell>{new Date(quote.createdAt).toLocaleDateString()}</TableCell>
                                    <TableCell>{quote.validUntil ? new Date(quote.validUntil).toLocaleDateString() : ""}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </CardContent>
        </Card>
    )
}
