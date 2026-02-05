import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

import type { RecurringInvoice } from "@/types"
import { useTranslation } from "react-i18next"

interface RecurringInvoiceViewDialogProps {
    recurringInvoice: RecurringInvoice | null
    onOpenChange: (open: boolean) => void
}

export function RecurringInvoiceViewDialog({ recurringInvoice, onOpenChange }: RecurringInvoiceViewDialogProps) {
    const { t } = useTranslation()

    if (!recurringInvoice) return null

    return (
        <Dialog open={!!recurringInvoice} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[95vw] lg:max-w-3xl max-h-[90dvh] flex flex-col">
                <DialogHeader className="flex-shrink-0">
                    <DialogTitle className="text-xl font-semibold">
                        {t("recurringInvoices.view.title")}
                    </DialogTitle>
                    <DialogDescription className="text-muted-foreground">{t("recurringInvoices.view.description")}</DialogDescription>
                </DialogHeader>


                <div className="overflow-auto mt-2 flex-1 flex flex-col gap-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 bg-muted/50 p-4 rounded-lg">
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 bg-muted/50 p-4 rounded-lg">
                        <div>
                            <p className="text-sm text-muted-foreground">{t("recurringInvoices.view.fields.client")}</p>
                            <p className="font-medium">{recurringInvoice.client?.name || recurringInvoice.client?.contactFirstname+ " " + recurringInvoice.client?.contactLastname || recurringInvoice.clientId}</p>
                        </div>

                        <div>
                            <p className="text-sm text-muted-foreground">{t("recurringInvoices.view.fields.paymentMethod")}</p>
                            <p className="font-medium">{recurringInvoice.paymentMethod?.name || recurringInvoice.paymentMethod?.type || "—"}</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 bg-muted/50 p-4 rounded-lg">
                        <div>
                            <p className="text-sm text-muted-foreground">{t("recurringInvoices.view.fields.totalHT")}</p>
                            <p className="font-medium">{t("common.valueWithCurrency", { amount: recurringInvoice.totalHT.toFixed(2), currency: recurringInvoice.currency })}</p>
                        </div>

                        <div>
                            <p className="text-sm text-muted-foreground">{t("recurringInvoices.view.fields.totalVAT")}</p>
                            <p className="font-medium">{t("common.valueWithCurrency", { amount: recurringInvoice.totalVAT.toFixed(2), currency: recurringInvoice.currency })}</p>
                        </div>

                        <div>
                            <p className="text-sm text-muted-foreground">{t("recurringInvoices.view.fields.totalTTC")}</p>
                            <p className="font-medium">{t("common.valueWithCurrency", { amount: recurringInvoice.totalTTC.toFixed(2), currency: recurringInvoice.currency })}</p>
                        </div>
                    </div>

                    {recurringInvoice.notes && (
                        <div className="bg-muted/50 p-4 rounded-lg">
                            <p className="text-sm text-muted-foreground mb-2">{t("recurringInvoices.view.fields.notes")}</p>
                            <p className="font-medium">{recurringInvoice.notes}</p>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
