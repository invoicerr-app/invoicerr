import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { Invoice, PaymentMethod } from "@/types"

import { PaymentMethodType } from "@/types"
import { format } from "date-fns"
import { languageToLocale } from "@/lib/i18n"
import { useTranslation } from "react-i18next"

interface InvoiceViewDialogProps {
    invoice: Invoice | null
    onOpenChange: (open: boolean) => void
}

export function InvoiceViewDialog({ invoice, onOpenChange }: InvoiceViewDialogProps) {
    const { t, i18n } = useTranslation()

    if (!invoice) return null

    const formatDate = (date?: string) => (date ? format(new Date(date), "PPP", { locale: languageToLocale(i18n.language) }) : "—")

    const getStatusLabel = (status: string) => {
        return t(`invoices.view.status.${status.toLowerCase()}`)
    }

    return (
        <Dialog open={!!invoice} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[95vw] lg:max-w-3xl max-h-[90dvh] flex flex-col">
                <DialogHeader className="flex-shrink-0">
                    <DialogTitle className="text-xl font-semibold">
                        {t("invoices.view.title", { number: invoice.number })}
                    </DialogTitle>
                    <DialogDescription className="text-muted-foreground">{t("invoices.view.description")}</DialogDescription>
                </DialogHeader>


                <div className="overflow-auto mt-2 flex-1 flex flex-col gap-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 bg-muted/50 p-4 rounded-lg">
                        <div>
                            <p className="text-sm text-muted-foreground">{t("invoices.view.fields.number")}</p>
                            <p className="font-medium">{invoice.number}</p>
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
                            <p className="font-medium">{invoice.client?.name || invoice.client?.contactFirstname + " " + invoice.client?.contactLastname || invoice.clientId}</p>
                        </div>

                        <div>
                            <p className="text-sm text-muted-foreground">{t("invoices.view.fields.paymentMethod")}</p>
                            <p className="font-medium">
                                {(() => {
                                    const pm: any = invoice.paymentMethod as PaymentMethod;
                                    if (pm) {
                                        return pm.name + " - " + (pm.type == PaymentMethodType.BANK_TRANSFER ? t("paymentMethods.fields.type.bank_transfer") : pm.type == PaymentMethodType.PAYPAL ? t("paymentMethods.fields.type.paypal") : pm.type == PaymentMethodType.CHECK ? t("paymentMethods.fields.type.check") : pm.type == PaymentMethodType.CASH ? t("paymentMethods.fields.type.cash") : pm.type == PaymentMethodType.OTHER ? t("paymentMethods.fields.type.other") : pm.type)
                                    }
                                    return "—";
                                })()}
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 bg-muted/50 p-4 rounded-lg">
                        {(invoice.items.some(item => item.vatRate > 0) ? (
                            <>
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
                            </>
                        ) : (
                            <div className="sm:col-span-3">
                                <p className="text-sm text-muted-foreground">{t("invoices.view.fields.total")}</p>
                                <p className="font-medium">{t("common.valueWithCurrency", {
                                    currency: invoice.currency,
                                    amount: invoice.totalTTC.toFixed(2)
                                })}</p>
                            </div>
                        ))}
                    </div>

                    {invoice.notes && (
                        <div className="bg-muted/50 p-4 rounded-lg">
                            <p className="text-sm text-muted-foreground mb-2">{t("invoices.view.fields.notes")}</p>
                            <p className="font-medium">{invoice.notes}</p>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
