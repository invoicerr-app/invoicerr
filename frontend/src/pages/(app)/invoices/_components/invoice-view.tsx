import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

import type { Invoice, PaymentMethod } from "@/types"
import { DocumentKind, PaymentMethodType, getDisplayInvoiceStatus, getInvoiceKindLabel, getInvoiceKindColor } from "@/types"
import { format } from "date-fns"
import { languageToLocale } from "@/lib/i18n"
import { getDraftWatermarkLabel } from "@/lib/watermark"
import { useTranslation } from "react-i18next"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useAvailableActions } from "@/hooks/queries/use-available-actions"
import { useGet } from "@/hooks/use-fetch"
import { authenticatedFetch } from "@/hooks/use-fetch"
import { toast } from "sonner"
import { Edit, RotateCcw, XCircle, Send, ArrowRightLeft, Banknote } from "lucide-react"
import { DepositDialog } from "./deposit-dialog"
import { useState } from "react"

interface InvoiceViewDialogProps {
    invoice: Invoice | null
    onOpenChange: (open: boolean) => void
    onMutate?: () => void
}

export function InvoiceViewDialog({ invoice, onOpenChange, onMutate }: InvoiceViewDialogProps) {
    const { t, i18n } = useTranslation()
    const { data: actions } = useAvailableActions(invoice?.id)
    const [depositOpen, setDepositOpen] = useState(false)

    // Fetch the original invoice when this one corrects another
    const { data: originalInvoice } = useGet<Invoice>(
        invoice?.correctsInvoiceId ? `/api/invoices/${invoice.correctsInvoiceId}` : null,
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

    const handleAction = (action: string) => {
        if (!invoice) return
        const url = action === 'cancelAndReplace'
            ? `/api/invoices/${invoice.id}/cancel-and-replace`
            : action === 'convertToInvoice'
            ? `/api/invoices/${invoice.id}/convert-to-invoice`
            : `/api/invoices/${invoice.id}/${action}`

        authenticatedFetch(url, { method: 'POST', body: JSON.stringify({}) })
            .then(async (res) => {
                const data = await res.json()
                if (action === 'cancel' && !data.accepted) {
                    toast.error(data.reason || t("invoices.list.messages.cancelError"))
                } else if (action === 'convertToInvoice' && data.id) {
                    toast.success(t("invoices.view.actions.convertToInvoiceSuccess"))
                    onMutate?.()
                    onOpenChange(false)
                } else if (data.correctionInvoiceId || data.accepted || data.replacementId) {
                    toast.success(t(`invoices.view.actions.${action}Success`))
                    onMutate?.()
                    onOpenChange(false)
                } else {
                    toast.error(data.message || t(`invoices.view.actions.${action}Error`))
                }
            })
            .catch(() => {
                toast.error(t(`invoices.view.actions.${action}Error`))
            })
    }

    return (
        <>
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

                {/* Available actions from the compliance plan */}
                {actions && (
                    <div className="flex flex-wrap gap-2 flex-shrink-0" data-cy="available-actions">
                        {actions.actions.edit && (
                            <Button size="sm" variant="outline" onClick={() => { onOpenChange(false) }} data-cy="action-edit">
                                <Edit className="h-3.5 w-3.5 mr-1.5" />
                                {t("invoices.view.actions.edit")}
                            </Button>
                        )}
                        {actions.actions.correct && actions.correctionKinds.includes("CREDIT_NOTE") && (
                            <Button size="sm" variant="outline" onClick={() => handleAction("correct")} data-cy="action-correct">
                                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                                {t("invoices.view.actions.creditNote")}
                            </Button>
                        )}
                        {actions.actions.correct && actions.correctionKinds.includes("CORRECTIVE_INVOICE") && (
                            <Button size="sm" variant="outline" onClick={() => handleAction("correct")} data-cy="action-corrective">
                                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                                {t("invoices.view.actions.correctiveInvoice")}
                            </Button>
                        )}
                        {actions.actions.cancel && (
                            <Button size="sm" variant="outline" onClick={() => handleAction("cancel")} data-cy="action-cancel" className="text-red-600 hover:text-red-700">
                                <XCircle className="h-3.5 w-3.5 mr-1.5" />
                                {t("invoices.view.actions.cancel")}
                            </Button>
                        )}
                        {actions.actions.cancelAndReplace && (
                            <Button size="sm" variant="outline" onClick={() => handleAction("cancelAndReplace")} data-cy="action-cancel-replace" className="text-red-600 hover:text-red-700">
                                <XCircle className="h-3.5 w-3.5 mr-1.5" />
                                {t("invoices.view.actions.cancelAndReplace")}
                            </Button>
                        )}
                        {actions.actions.send && (
                            <Button size="sm" variant="outline" onClick={() => handleAction("send")} data-cy="action-send">
                                <Send className="h-3.5 w-3.5 mr-1.5" />
                                {t("invoices.view.actions.send")}
                            </Button>
                        )}
                        {actions.actions.convertToInvoice && (
                            <Button size="sm" variant="outline" onClick={() => handleAction("convertToInvoice")} data-cy="action-convert-proforma">
                                <ArrowRightLeft className="h-3.5 w-3.5 mr-1.5" />
                                {t("invoices.view.actions.convertToInvoice")}
                            </Button>
                        )}
                        {actions.actions.deposit && (
                            <Button size="sm" variant="outline" onClick={() => setDepositOpen(true)} data-cy="action-deposit">
                                <Banknote className="h-3.5 w-3.5 mr-1.5" />
                                {t("invoices.view.actions.deposit")}
                            </Button>
                        )}
                    </div>
                )}

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

                    {(() => {
                        const compDoc = invoice.complianceDocuments?.[0]
                        if (!compDoc) return null
                        const statusColors: Record<string, string> = {
                            CLEARED: 'text-emerald-700 bg-emerald-50',
                            DELIVERED: 'text-emerald-700 bg-emerald-50',
                            ACCEPTED: 'text-emerald-700 bg-emerald-50',
                            REPORTED: 'text-emerald-700 bg-emerald-50',
                            ISSUED: 'text-violet-700 bg-violet-50',
                            PENDING_CLEARANCE: 'text-amber-700 bg-amber-50',
                            AWAITING_RESPONSE: 'text-amber-700 bg-amber-50',
                            DISPUTED: 'text-amber-700 bg-amber-50',
                            CONTINGENCY: 'text-amber-700 bg-amber-50',
                            REJECTED: 'text-red-700 bg-red-50',
                            REFUSED: 'text-red-700 bg-red-50',
                            CANCELLED: 'text-red-700 bg-red-50',
                        }
                        const color = statusColors[compDoc.status] ?? 'text-slate-500 bg-slate-50'
                        return (
                            <div className="mt-6 border-t pt-4">
                                <div className="flex items-center justify-between mb-3">
                                    <span className="text-sm font-medium text-muted-foreground">Compliance</span>
                                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${color}`}>
                                        {compDoc.status.replace(/_/g, ' ')}
                                    </span>
                                </div>
                                {compDoc.events && compDoc.events.length > 0 && (
                                    <ol className="relative border-l border-muted ml-2 space-y-3">
                                        {compDoc.events.map((ev, i) => (
                                            <li key={i} className="ml-4">
                                                <span className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full border-2 border-background bg-muted-foreground/40" />
                                                <p className="text-xs font-medium text-foreground">{ev.type.replace(/_/g, ' ')}</p>
                                                <p className="text-xs text-muted-foreground">
                                                    {new Date(ev.at).toLocaleString()}
                                                    {ev.actor && ev.actor !== 'system' && ` · ${ev.actor}`}
                                                    {ev.detail && ` — ${ev.detail}`}
                                                </p>
                                            </li>
                                        ))}
                                    </ol>
                                )}
                            </div>
                        )
                    })()}

                    {/* Correction → original link */}
                    {isCorrection && invoice.correctsInvoiceId && (
                        <div className="bg-muted/50 p-4 rounded-lg" data-cy="correction-original-link">
                            <p className="text-sm text-muted-foreground mb-1">{t("invoices.view.fields.correctsInvoice")}</p>
                            {originalInvoice ? (
                                <p className="font-medium text-sm">
                                    {originalInvoice.rawNumber || originalInvoice.number?.toString() || originalInvoice.id.slice(0, 8)}
                                </p>
                            ) : (
                                <p className="font-medium text-sm text-muted-foreground">
                                    {invoice.correctsInvoiceId.slice(0, 8)}…
                                </p>
                            )}
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

                    {/* Linked deposit invoices (for FINAL kind or parent with deposits) */}
                    {invoice.depositInvoices && invoice.depositInvoices.length > 0 && (
                        <div className="bg-muted/50 p-4 rounded-lg" data-cy="linked-deposits">
                            <p className="text-sm text-muted-foreground mb-2">{t("invoices.view.fields.linkedDeposits")}</p>
                            <div className="flex flex-col gap-1">
                                {invoice.depositInvoices.map((dep) => (
                                    <div key={dep.id} className="flex items-center gap-2 text-sm">
                                        <Badge variant="secondary" className={`text-xs ${getInvoiceKindColor(dep.kind)}`}>
                                            {getInvoiceKindLabel(dep.kind)}
                                        </Badge>
                                        <span className="font-medium">{dep.rawNumber || dep.number?.toString()}</span>
                                        <span className="text-muted-foreground">
                                            {dep.totalTTC.toFixed(2)} {dep.currency}
                                        </span>
                                    </div>
                                ))}
                            </div>
                            <div className="mt-2 pt-2 border-t flex justify-end text-sm font-medium">
                                {t("invoices.view.fields.totalDeposited")}: {
                                    invoice.depositInvoices.reduce((sum, dep) => sum + dep.totalTTC, 0).toFixed(2)
                                } {invoice.currency}
                            </div>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>

        <DepositDialog
            open={depositOpen}
            onOpenChange={setDepositOpen}
            defaultClientId={invoice?.clientId}
            defaultCurrency={invoice?.currency}
        />
        </>
    )
}
