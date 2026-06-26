import { ArrowDown, ArrowUp, Download, X } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import SearchSelect from "@/components/search-input"
import { Spinner } from "@/components/ui/spinner"
import { useClientSearch, useQuotesTable } from "@/hooks/queries"
import { useTranslation } from "react-i18next"

const ALL = "__all__"

function csvEscape(value: string) {
    if (/[",\n]/.test(value)) {
        return `"${value.replace(/"/g, '""')}"`
    }
    return value
}

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

    const handleExport = () => {
        const header = [
            t("quotes.table.columns.number"),
            t("quotes.table.columns.client"),
            t("quotes.table.columns.status"),
            t("quotes.table.columns.totalTTC"),
            t("quotes.table.columns.createdAt"),
            t("quotes.table.columns.validUntil"),
        ]

        const lines = rows.map((quote) => [
            quote.rawNumber || quote.number?.toString() ?? "",
            quote.client?.name || "",
            getStatusLabel(quote.status),
            quote.totalTTC.toFixed(2),
            new Date(quote.createdAt).toLocaleDateString(),
            quote.validUntil ? new Date(quote.validUntil).toLocaleDateString() : "",
        ])

        const csv = [header, ...lines]
            .map((line) => line.map((cell) => csvEscape(String(cell))).join(","))
            .join("\n")

        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
        const url = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = url
        link.download = "quotes.csv"
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
                        <label className="text-sm font-medium">{t("quotes.table.filters.client")}</label>
                        <div className="flex items-center gap-1">
                            <SearchSelect
                                options={(clientOptions ?? []).map((client) => ({
                                    label: client.name || `${client.contactFirstname} ${client.contactLastname}`,
                                    value: client.id,
                                }))}
                                value={clientId ?? ""}
                                onValueChange={(val) => setClientId((val as string) || undefined)}
                                onSearchChange={setClientSearchTerm}
                                placeholder={t("quotes.table.filters.clientPlaceholder")}
                                noResultsText={t("quotes.table.filters.clientNoResults")}
                                data-cy="quote-table-client-filter"
                            />
                            {clientId && (
                                <Button type="button" variant="ghost" size="icon" className="shrink-0" onClick={() => setClientId(undefined)}>
                                    <X className="h-4 w-4" />
                                </Button>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="text-sm font-medium">{t("quotes.table.filters.year")}</label>
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
                                <SelectItem value={ALL}>{t("quotes.table.filters.allYears")}</SelectItem>
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
                            <label className="text-sm font-medium">{t("quotes.table.filters.month")}</label>
                            <Select
                                value={month !== undefined ? String(month) : ALL}
                                onValueChange={(val) => setMonth(val === ALL ? undefined : Number(val))}
                            >
                                <SelectTrigger size="sm" className="w-[160px]">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={ALL}>{t("quotes.table.filters.allMonths")}</SelectItem>
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
                        {t("quotes.table.actions.export")}
                    </Button>
                </div>

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
