import { ArrowDown, ArrowUp } from "lucide-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { TableFilterBar, TableSearchFilter } from "@/components/table-filter-bar"
import { useState } from "react"

import { Card, CardContent } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { useClientSearch, useInvoiceSearch, usePaymentsTable } from "@/hooks/queries"
import { useTableExport } from "@/hooks/use-table-export"
import { useTranslation } from "react-i18next"

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
        return invoice ? (invoice.rawNumber || (invoice.number?.toString() ?? "")) : ""
    }

    const paymentMethodLabel = (payment: (typeof rows)[number]) => {
        const pm = payment.paymentMethod as unknown
        if (!pm) return ""
        if (typeof pm === "string") return pm
        return (pm as { name?: string }).name ?? ""
    }

    const { handleExport } = useTableExport(rows, [
        { header: t("payments.table.columns.number"), cell: (payment) => payment.rawNumber || (payment.number?.toString() ?? "") },
        { header: t("payments.table.columns.invoice"), cell: (payment) => payment.invoice?.rawNumber || payment.invoice?.number?.toString() || "" },
        { header: t("payments.table.columns.client"), cell: (payment) => payment.invoice?.client?.name || "" },
        { header: t("payments.table.columns.totalPaid"), cell: (payment) => payment.totalPaid.toFixed(2) },
        { header: t("payments.table.columns.paidAt"), cell: (payment) => payment.paidAt ? new Date(payment.paidAt).toLocaleDateString() : "" },
        { header: t("payments.table.columns.paymentMethod"), cell: (payment) => paymentMethodLabel(payment) },
    ], "payments.csv")

    return (
        <Card className="gap-0">
            <CardContent className="p-4 sm:p-6 space-y-4">
                <TableFilterBar
                    translationPrefix="payments"
                    year={year}
                    onYearChange={setYear}
                    month={month}
                    onMonthChange={setMonth}
                    onExport={handleExport}
                    exportDisabled={rows.length === 0}
                >
                    <TableSearchFilter
                        label={t("payments.table.filters.invoice")}
                        options={(invoiceOptions ?? []).map((invoice) => ({
                            label: invoice.rawNumber || (invoice.number?.toString() ?? ""),
                            value: invoice.id,
                        }))}
                        value={invoiceId}
                        onValueChange={setInvoiceId}
                        onSearchChange={setInvoiceSearchTerm}
                        placeholder={t("payments.table.filters.invoicePlaceholder")}
                        noResultsText={t("payments.table.filters.invoiceNoResults")}
                        dataCy="payment-table-invoice-filter"
                    />
                    <TableSearchFilter
                        label={t("payments.table.filters.client")}
                        options={(clientOptions ?? []).map((client) => ({
                            label: client.name || `${client.contactFirstname} ${client.contactLastname}`,
                            value: client.id,
                        }))}
                        value={clientId}
                        onValueChange={setClientId}
                        onSearchChange={setClientSearchTerm}
                        placeholder={t("payments.table.filters.clientPlaceholder")}
                        noResultsText={t("payments.table.filters.clientNoResults")}
                        dataCy="payment-table-client-filter"
                    />
                </TableFilterBar>

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
