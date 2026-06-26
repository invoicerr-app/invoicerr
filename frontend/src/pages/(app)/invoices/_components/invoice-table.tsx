import { ArrowDown, ArrowUp, Download, X } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import SearchSelect from "@/components/search-input"
import { Spinner } from "@/components/ui/spinner"
import { getDisplayInvoiceStatus } from "@/types"
import { useClientSearch, useInvoicesTable } from "@/hooks/queries"
import { useTranslation } from "react-i18next"

const ALL = "__all__"

function csvEscape(value: string) {
    if (/[",\n]/.test(value)) {
        return `"${value.replace(/"/g, '""')}"`
    }
    return value
}

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

    const getStatusLabel = (status: string) => t(`invoices.list.status.${getDisplayInvoiceStatus(status).toLowerCase()}`)

    const handleExport = () => {
        const header = [
            t("invoices.table.columns.number"),
            t("invoices.table.columns.client"),
            t("invoices.table.columns.status"),
            t("invoices.table.columns.totalTTC"),
            t("invoices.table.columns.createdAt"),
            t("invoices.table.columns.dueDate"),
        ]

        const lines = rows.map((invoice) => [
            invoice.rawNumber || (invoice.number?.toString() ?? ""),
            invoice.client?.name || "",
            getStatusLabel(invoice.status),
            invoice.totalTTC.toFixed(2),
            new Date(invoice.createdAt).toLocaleDateString(),
            invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : "",
        ])

        const csv = [header, ...lines]
            .map((line) => line.map((cell) => csvEscape(String(cell))).join(","))
            .join("\n")

        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
        const url = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = url
        link.download = "invoices.csv"
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
    }

    const months = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), [])
    const currentYear = new Date().getFullYear()
    const years = useMemo(
        () => Array.from({ length: currentYear - 2000 + 1 }, (_, i) => currentYear - i),
        [currentYear],
    )

    return (
        <Card className="gap-0">
            <CardContent className="p-4 sm:p-6 space-y-4">
                <div className="flex flex-wrap items-end gap-3">
                    <div className="flex flex-col gap-2 min-w-[220px]">
                        <label className="text-sm font-medium">{t("invoices.table.filters.client")}</label>
                        <div className="flex items-center gap-1">
                            <SearchSelect
                                options={(clientOptions ?? []).map((client) => ({
                                    label: client.name || `${client.contactFirstname} ${client.contactLastname}`,
                                    value: client.id,
                                }))}
                                value={clientId ?? ""}
                                onValueChange={(val) => setClientId((val as string) || undefined)}
                                onSearchChange={setClientSearchTerm}
                                placeholder={t("invoices.table.filters.clientPlaceholder")}
                                noResultsText={t("invoices.table.filters.clientNoResults")}
                                data-cy="invoice-table-client-filter"
                            />
                            {clientId && (
                                <Button type="button" variant="ghost" size="icon" className="shrink-0" onClick={() => setClientId(undefined)}>
                                    <X className="h-4 w-4" />
                                </Button>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="text-sm font-medium">{t("invoices.table.filters.year")}</label>
                        <Select
                            value={year !== undefined ? String(year) : ALL}
                            onValueChange={(val) => {
                                if (val === ALL) {
                                    setYear(undefined)
                                    setMonth(undefined)
                                } else {
                                    setYear(Number(val))
                                }
                            }}
                        >
                            <SelectTrigger size="sm" className="w-[160px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ALL}>{t("invoices.table.filters.allYears")}</SelectItem>
                                {years.map((y) => (
                                    <SelectItem key={y} value={String(y)}>
                                        {y}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {year !== undefined && (
                        <div className="flex flex-col gap-2">
                            <label className="text-sm font-medium">{t("invoices.table.filters.month")}</label>
                            <Select
                                value={month !== undefined ? String(month) : ALL}
                                onValueChange={(val) => setMonth(val === ALL ? undefined : Number(val))}
                            >
                                <SelectTrigger size="sm" className="w-[160px]">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={ALL}>{t("invoices.table.filters.allMonths")}</SelectItem>
                                    {months.map((m) => (
                                        <SelectItem key={m} value={String(m)}>
                                            {new Date(2000, m - 1, 1).toLocaleDateString(undefined, { month: "long" })}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    <Button type="button" variant="outline" size="sm" onClick={handleExport} disabled={rows.length === 0} className="ml-auto">
                        <Download className="h-4 w-4 mr-2" />
                        {t("invoices.table.actions.export")}
                    </Button>
                </div>

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
                                    <TableCell>{invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : ""}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </CardContent>
        </Card>
    )
}
