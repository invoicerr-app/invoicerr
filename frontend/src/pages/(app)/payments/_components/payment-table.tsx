import { ArrowDown, ArrowUp, Download, X } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import SearchSelect from "@/components/search-input"
import { Spinner } from "@/components/ui/spinner"
import { useClientSearch, useInvoiceSearch, usePaymentsTable } from "@/hooks/queries"
import { useTranslation } from "react-i18next"

const ALL = "__all__"

function csvEscape(value: string) {
    if (/[",\n]/.test(value)) {
        return `"${value.replace(/"/g, '""')}"`
    }
    return value
}

export function PaymentTable() {
    const { t } = useTranslation()

    const [invoiceId, setInvoiceId] = useState<string | undefined>(undefined)
    const [invoiceSearchTerm, setInvoiceSearchTerm] = useState("")
    const [clientId, setClientId] = useState<string | undefined>(undefined)
    const [clientSearchTerm, setClientSearchTerm] = useState("")
    const [year, setYear] = useState<number | undefined>(undefined)
    const [month, setMonth] = useState<number | undefined>(undefined)
    const [sort, setSort] = useState<"asc" | "desc">("desc")

    const { data: invoiceOptions } = useInvoiceSearch(invoiceSearchTerm)
    const { data: clientOptions } = useClientSearch(clientSearchTerm)

    const { data: payments, isLoading } = usePaymentsTable({ invoiceId, clientId, year, month, sort })
    const rows = payments ?? []

    const invoiceLabel = (invoiceIdValue?: string) => {
        const invoice = invoiceOptions?.find((inv) => inv.id === invoiceIdValue)
        return invoice ? (invoice.rawNumber || invoice.number.toString()) : ""
    }

    const paymentMethodLabel = (payment: (typeof rows)[number]) => {
        const pm = payment.paymentMethod as unknown
        if (!pm) return ""
        if (typeof pm === "string") return pm
        return (pm as { name?: string }).name ?? ""
    }

    const handleExport = () => {
        const header = [
            t("payments.table.columns.number"),
            t("payments.table.columns.invoice"),
            t("payments.table.columns.client"),
            t("payments.table.columns.totalPaid"),
            t("payments.table.columns.paidAt"),
            t("payments.table.columns.paymentMethod"),
        ]

        const lines = rows.map((payment) => [
            payment.rawNumber || payment.number.toString(),
            payment.invoice?.rawNumber || payment.invoice?.number?.toString() || "",
            payment.invoice?.client?.name || "",
            payment.totalPaid.toFixed(2),
            payment.paidAt ? new Date(payment.paidAt).toLocaleDateString() : "",
            paymentMethodLabel(payment),
        ])

        const csv = [header, ...lines]
            .map((line) => line.map((cell) => csvEscape(String(cell))).join(","))
            .join("\n")

        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
        const url = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = url
        link.download = "payments.csv"
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
    }

    const months = useMemo(
        () => Array.from({ length: 12 }, (_, i) => i + 1),
        [],
    )

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
                        <label className="text-sm font-medium">{t("payments.table.filters.invoice")}</label>
                        <div className="flex items-center gap-1">
                            <SearchSelect
                                options={(invoiceOptions ?? []).map((invoice) => ({
                                    label: invoice.rawNumber || invoice.number.toString(),
                                    value: invoice.id,
                                }))}
                                value={invoiceId ?? ""}
                                onValueChange={(val) => setInvoiceId((val as string) || undefined)}
                                onSearchChange={setInvoiceSearchTerm}
                                placeholder={t("payments.table.filters.invoicePlaceholder")}
                                noResultsText={t("payments.table.filters.invoiceNoResults")}
                                data-cy="payment-table-invoice-filter"
                            />
                            {invoiceId && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="shrink-0"
                                    onClick={() => setInvoiceId(undefined)}
                                >
                                    <X className="h-4 w-4" />
                                </Button>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-col gap-2 min-w-[220px]">
                        <label className="text-sm font-medium">{t("payments.table.filters.client")}</label>
                        <div className="flex items-center gap-1">
                            <SearchSelect
                                options={(clientOptions ?? []).map((client) => ({
                                    label: client.name || `${client.contactFirstname} ${client.contactLastname}`,
                                    value: client.id,
                                }))}
                                value={clientId ?? ""}
                                onValueChange={(val) => setClientId((val as string) || undefined)}
                                onSearchChange={setClientSearchTerm}
                                placeholder={t("payments.table.filters.clientPlaceholder")}
                                noResultsText={t("payments.table.filters.clientNoResults")}
                                data-cy="payment-table-client-filter"
                            />
                            {clientId && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="shrink-0"
                                    onClick={() => setClientId(undefined)}
                                >
                                    <X className="h-4 w-4" />
                                </Button>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="text-sm font-medium">{t("payments.table.filters.year")}</label>
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
                                <SelectItem value={ALL}>{t("payments.table.filters.allYears")}</SelectItem>
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
                            <label className="text-sm font-medium">{t("payments.table.filters.month")}</label>
                            <Select
                                value={month !== undefined ? String(month) : ALL}
                                onValueChange={(val) => setMonth(val === ALL ? undefined : Number(val))}
                            >
                                <SelectTrigger size="sm" className="w-[160px]">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={ALL}>{t("payments.table.filters.allMonths")}</SelectItem>
                                    {months.map((m) => (
                                        <SelectItem key={m} value={String(m)}>
                                            {new Date(2000, m - 1, 1).toLocaleDateString(undefined, { month: "long" })}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleExport}
                        disabled={rows.length === 0}
                        className="ml-auto"
                    >
                        <Download className="h-4 w-4 mr-2" />
                        {t("payments.table.actions.export")}
                    </Button>
                </div>

                {isLoading ? (
                    <div className="flex items-center justify-center py-12">
                        <Spinner className="h-8 w-8" />
                    </div>
                ) : rows.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-12">
                        {t("payments.table.emptyState")}
                    </p>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>{t("payments.table.columns.number")}</TableHead>
                                <TableHead>{t("payments.table.columns.invoice")}</TableHead>
                                <TableHead>{t("payments.table.columns.client")}</TableHead>
                                <TableHead>{t("payments.table.columns.totalPaid")}</TableHead>
                                <TableHead>
                                    <button
                                        type="button"
                                        className="flex items-center gap-1"
                                        onClick={() => setSort((s) => (s === "asc" ? "desc" : "asc"))}
                                    >
                                        {t("payments.table.columns.paidAt")}
                                        {sort === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                                    </button>
                                </TableHead>
                                <TableHead>{t("payments.table.columns.paymentMethod")}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows.map((payment) => (
                                <TableRow key={payment.id}>
                                    <TableCell>{payment.rawNumber || payment.number}</TableCell>
                                    <TableCell>{payment.invoice?.rawNumber || payment.invoice?.number || invoiceLabel(payment.invoiceId)}</TableCell>
                                    <TableCell>{payment.invoice?.client?.name || ""}</TableCell>
                                    <TableCell>
                                        {t("common.valueWithCurrency", {
                                            currency: payment.invoice?.currency || "",
                                            amount: payment.totalPaid.toFixed(2),
                                        })}
                                    </TableCell>
                                    <TableCell>{payment.paidAt ? new Date(payment.paidAt).toLocaleDateString() : ""}</TableCell>
                                    <TableCell>{paymentMethodLabel(payment)}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </CardContent>
        </Card>
    )
}
