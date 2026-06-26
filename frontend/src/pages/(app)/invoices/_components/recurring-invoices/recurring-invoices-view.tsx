import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"

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
            <DialogContent className="max-w-[95vw] lg:max-w-3xl max-h-[90dvh] flex flex-col" data-cy="recurring-invoice-view-dialog">
                <DialogHeader className="flex-shrink-0">
                    <DialogTitle className="text-xl font-semibold">
                        {t("recurringInvoices.view.title")}
                    </DialogTitle>
                    <DialogDescription className="text-muted-foreground">{t("recurringInvoices.view.description")}</DialogDescription>
                </DialogHeader>


                <div className="overflow-auto mt-2 flex-1 flex flex-col gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                        {recurringInvoice.paused && (
                            <Badge variant="outline" className="text-yellow-700 border-yellow-300 bg-yellow-50">
                                {t("recurringInvoices.list.item.paused")}
                            </Badge>
                        )}
                        {recurringInvoice.autoIssue && (
                            <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50">
                                {t("recurringInvoices.list.item.autoIssue")}
                            </Badge>
                        )}
                        {recurringInvoice.autoSend && (
                            <Badge variant="outline" className="text-blue-700 border-blue-300 bg-blue-50">
                                {t("recurringInvoices.list.item.autoSend")}
                            </Badge>
                        )}
                        {recurringInvoice.skipNext && (
                            <Badge variant="outline" className="text-orange-700 border-orange-300 bg-orange-50">
                                {t("recurringInvoices.list.item.skipNext")}
                            </Badge>
                        )}
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

                        <div>
                            <p className="text-sm text-muted-foreground">{t("recurringInvoices.view.fields.frequency")}</p>
                            <p className="font-medium">{t(`recurringInvoices.frequency.${recurringInvoice.frequency.toLowerCase()}`)}</p>
                        </div>

                        <div>
                            <p className="text-sm text-muted-foreground">{t("recurringInvoices.view.fields.nextRun")}</p>
                            <p className="font-medium">{recurringInvoice.nextInvoiceDate ? new Date(recurringInvoice.nextInvoiceDate).toLocaleDateString() : "—"}</p>
                        </div>

                        <div>
                            <p className="text-sm text-muted-foreground">{t("recurringInvoices.view.fields.lastRun")}</p>
                            <p className="font-medium">{recurringInvoice.lastInvoiceDate ? new Date(recurringInvoice.lastInvoiceDate).toLocaleDateString() : "—"}</p>
                        </div>

                        <div>
                            <p className="text-sm text-muted-foreground">{t("recurringInvoices.view.fields.generatedCount")}</p>
                            <p className="font-medium">{(recurringInvoice as any)._count?.generatedInvoices ?? "0"}</p>
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

                    {/* Generated invoices list */}
                    {(recurringInvoice as any).generatedInvoices && (recurringInvoice as any).generatedInvoices.length > 0 && (
                        <div className="bg-muted/50 p-4 rounded-lg">
                            <p className="text-sm text-muted-foreground mb-2">{t("recurringInvoices.view.fields.generatedInvoices")}</p>
                            <div className="divide-y rounded border bg-background">
                                {(recurringInvoice as any).generatedInvoices.map((inv: any) => (
                                    <div key={inv.id} className="flex items-center justify-between px-3 py-2 text-sm">
                                        <span className="font-medium">{inv.rawNumber || `#${inv.number || 'DRAFT'}`}</span>
                                        <span className="text-muted-foreground">{inv.status}</span>
                                        <span>{t("common.valueWithCurrency", { amount: inv.totalTTC.toFixed(2), currency: inv.currency })}</span>
                                        <span className="text-muted-foreground">{new Date(inv.createdAt).toLocaleDateString()}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
