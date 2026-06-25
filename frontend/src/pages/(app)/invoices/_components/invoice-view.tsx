import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

import type { Invoice, PaymentMethod } from "@/types"
import { DocumentKind, PaymentMethodType, getDisplayInvoiceStatus, getInvoiceKindLabel, getInvoiceKindColor } from "@/types"
import { format } from "date-fns"
import { languageToLocale } from "@/lib/i18n"
import { getDraftWatermarkLabel } from "@/lib/watermark"
import { useTranslation } from "react-i18next"
import { Badge } from "@/components/ui/badge"
import { useAvailableActions } from "@/hooks/queries/use-available-actions"
import { useGet } from "@/hooks/use-fetch"

interface InvoiceViewDialogProps {
    invoice: Invoice | null
    onOpenChange: (open: boolean) => void
}

export function InvoiceViewDialog({ invoice, onOpenChange }: InvoiceViewDialogProps) {
    const { t, i18n } = useTranslation()
    const { data: actions } = useAvailableActions(invoice?.id)

    // Fetch the original invoice when this one corrects another
    const { data: originalInvoice } = useGet<Invoice>(
        invoice?.correctsInvoiceId ? `/api/invoices?page=1` : null,
    )

    if (!invoice) return null

    const formatDate = (date?: string) => (date ? format(new Date(date), "PPP", { locale: languageToLocale(i18n.language) }) : "—")
    const discountRateValue = Number(invoice.discountRate ?? 0)
    const subtotalBeforeDiscount = invoice.items?.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0) ?? 0
    const discountAmount = Math.max(0, subtotalBeforeDiscount - invoice.totalHT)

    const getStatusLabel = (status: string) => {
        return t(`invoices.view.status.${getDisplayInvoiceStatus(status).toLowerCase()}`)
    }

    const kindLabel = getInvoiceKindLabel(invoice.kind)
    const kindColor = getInvoiceKindColor(invoice.kind)
    const isCorrection = invoice.kind === DocumentKind.CREDIT_NOTE || invoice.kind === DocumentKind.CORRECTIVE_INVOICE || invoice.kind === DocumentKind.DEBIT_NOTE
    const correctedBy = invoice.correctedBy ?? []

    return (
        <Dialog open={!!invoice} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[95vw] lg:max-w-3xl max-h-[90dvh] flex flex-col overflow-hidden">
                {invoice.status === "DRAFT" && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-50 overflow-hidden">
                        <span className="text-8xl font-bold text-red-500/15 -rotate-[30deg] select-none whitespace-nowrap">
                            {getDraftWatermarkLabel(invoice.company?.country)}
                        </span>
                    </div>
                )}
                <DialogHeader className="flex-shrink-0">
                    <DialogTitle className="text-xl font-semibold flex items-center gap-2">
                        {t("invoices.view.title", { number: invoice.rawNumber || invoice.number?.toString() || "DRAFT" })}
                        {invoice.kind && invoice.kind !== DocumentKind.INVOICE && (
                            <Badge variant="secondary" className={`text-xs ${kindColor}`}>
                                {kindLabel}
                            </Badge>
                        )}
                    </DialogTitle>
                    <DialogDescription className="text-muted-foreground">{t("invoices.view.description")}</DialogDescription>
                </DialogHeader>


                <div className="overflow-auto mt-2 flex-1 flex flex-col gap-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 bg-muted/50 p-4 rounded-lg">
                        <div>
                            <p className="text-sm text-muted-foreground">{t("invoices.view.fields.number")}</p>
                            <p className="font-medium">{invoice.rawNumber || invoice.number?.toString() || "DRAFT"}</p>
                        </div>

                        <div>
                            <p className="text-sm text-muted-foreground">{t("invoices.view.fields.title")}</p>
                            <p className="font-medium">{invoice.title || "—"}</p>
                        </div>

                        <div>
                            <p className="text-sm text-muted-foreground">{t("invoices.view.fields.status")}</p>
                            <p className="font-medium">{getStatusLabel(invoice.status)}</p>
                        </div>

                        <div>
                            <p className="text-sm text-muted-foreground">{t("invoices.view.fields.createdAt")}</p>
                            <p className="font-medium">{formatDate(invoice.createdAt)}</p>
                        </div>

                        <div>
                            <p className="text-sm text-muted-foreground">{t("invoices.view.fields.dueDate")}</p>
                            <p className="font-medium">{formatDate(invoice.dueDate)}</p>
                        </div>

                        <div>
                            <p className="text-sm text-muted-foreground">{t("invoices.view.fields.paidAt")}</p>
                            <p className="font-medium">{formatDate(invoice.paidAt)}</p>
                        </div>

                        <div>
                            <p className="text-sm text-muted-foreground">{t("invoices.view.fields.updatedAt")}</p>
                            <p className="font-medium">{formatDate(invoice.updatedAt)}</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 bg-muted/50 p-4 rounded-lg">
                        <div>
                            <p className="text-sm text-muted-foreground">{t("invoices.view.fields.client")}</p>
                            <p className="font-medium">{invoice.client?.name || invoice.client?.contactFirstname+" "+invoice.client?.contactLastname|| invoice.clientId}</p>
                        </div>

                        <div>
                            <p className="text-sm text-muted-foreground">{t("invoices.view.fields.paymentMethod")}</p>
                            <p className="font-medium">
                                {(() => {
                                    const pm: any = invoice.paymentMethod as PaymentMethod;
                                    if (pm) {
                                        return pm.name + " - " + (pm.type==PaymentMethodType.BANK_TRANSFER?t("paymentMethods.fields.type.bank_transfer"):pm.type==PaymentMethodType.PAYPAL?t("paymentMethods.fields.type.paypal"):pm.type==PaymentMethodType.CHECK?t("paymentMethods.fields.type.check"):pm.type==PaymentMethodType.CASH?t("paymentMethods.fields.type.cash"):pm.type==PaymentMethodType.OTHER?t("paymentMethods.fields.type.other"):pm.type)
                                    }
                                    return "—";
                                })()}
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 bg-muted/50 p-4 rounded-lg">
                        <div>
                            <p className="text-sm text-muted-foreground">{t("invoices.view.fields.totalHT")}</p>
                            <p className="font-medium">{t("common.valueWithCurrency", {
                                currency: invoice.currency,
                                amount: invoice.totalHT.toFixed(2)
                            })}</p>
                        </div>

                        <div>
                            <p className="text-sm text-muted-foreground">{t("invoices.view.fields.totalVAT")}</p>
                            <p className="font-medium">{t("common.valueWithCurrency", {
                                currency: invoice.currency,
                                amount: invoice.totalVAT.toFixed(2)
                            })}</p>
                        </div>

                        <div>
                            <p className="text-sm text-muted-foreground">{t("invoices.view.fields.totalTTC")}</p>
                            <p className="font-medium">{t("common.valueWithCurrency", {
                                currency: invoice.currency,
                                amount: invoice.totalTTC.toFixed(2)
                            })}</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 bg-muted/50 p-4 rounded-lg">
                        <div>
                            <p className="text-sm text-muted-foreground">{t("invoices.view.fields.discountRate")}</p>
                            <p className="font-medium">
                                {discountRateValue.toFixed(2).replace(/\.00$/, "")}%
                            </p>
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">{t("invoices.view.fields.discountAmount")}</p>
                            <p className="font-medium">{t("common.valueWithCurrency", {
                                currency: invoice.currency,
                                amount: discountAmount.toFixed(2)
                            })}</p>
                        </div>
                    </div>

                    {invoice.notes && (
                        <div className="bg-muted/50 p-4 rounded-lg">
                            <p className="text-sm text-muted-foreground mb-2">{t("invoices.view.fields.notes")}</p>
                            <p className="font-medium">{invoice.notes}</p>
                        </div>
                    )}

                    {invoice.complianceDocuments && invoice.complianceDocuments.length > 0 && (() => {
                        const doc = invoice.complianceDocuments![0]
                        const confidence = doc.plan?.confidence
                        const warnings = doc.plan?.warnings
                        if (!confidence && (!warnings || warnings.length === 0)) return null
                        return (
                            <div className="bg-muted/50 p-4 rounded-lg" data-cy="compliance-status">
                                <p className="text-sm text-muted-foreground mb-2">{t("invoices.view.fields.complianceStatus")}</p>
                                <div className="flex flex-wrap items-center gap-3">
                                    <span className="font-medium">{doc.status}</span>
                                    {confidence && (
                                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                                            confidence === "OFFICIAL" ? "bg-green-100 text-green-800" :
                                            confidence === "BEST_EFFORT" ? "bg-yellow-100 text-yellow-800" :
                                            "bg-gray-100 text-gray-600"
                                        }`}>
                                            {confidence}
                                        </span>
                                    )}
                                </div>
                                {warnings && warnings.length > 0 && (
                                    <ul className="mt-2 text-sm text-amber-700 list-disc list-inside">
                                        {warnings.map((w, i) => <li key={i}>{w}</li>)}
                                    </ul>
                                )}
                            </div>
                        )
                    })()}

                    {/* Correction ↔ original link */}
                    {isCorrection && invoice.correctsInvoiceId && (
                        <div className="bg-muted/50 p-4 rounded-lg" data-cy="correction-original-link">
                            <p className="text-sm text-muted-foreground mb-1">{t("invoices.view.fields.correctsInvoice")}</p>
                            <p className="font-medium text-sm">
                                {t("invoices.view.correctionOf", { number: invoice.correctsInvoiceId.slice(0, 8) })}
                            </p>
                        </div>
                    )}

                    {/* Corrections issued against this invoice */}
                    {correctedBy.length > 0 && (
                        <div className="bg-muted/50 p-4 rounded-lg" data-cy="corrections-section">
                            <p className="text-sm text-muted-foreground mb-2">{t("invoices.view.fields.corrections")}</p>
                            <div className="flex flex-col gap-1">
                                {correctedBy.map((c) => (
                                    <div key={c.id} className="flex items-center gap-2 text-sm">
                                        <Badge variant="secondary" className={`text-xs ${getInvoiceKindColor(c.kind)}`}>
                                            {getInvoiceKindLabel(c.kind)}
                                        </Badge>
                                        <span className="font-medium">{c.rawNumber || c.number?.toString()}</span>
                                        <span className="text-muted-foreground">
                                            {c.totalTTC.toFixed(2)} {c.currency}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Cancellation rejection reason */}
                    {actions && !actions.cancellation.allowed && actions.cancellation.reason && invoice.status !== "CANCELLED" && invoice.status !== "DRAFT" && (
                        <div className="bg-amber-50 border border-amber-200 p-3 rounded-lg text-sm text-amber-800" data-cy="cancellation-rejection">
                            {t("invoices.view.messages.cancellationNotAllowed")}: {actions.cancellation.reason}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
