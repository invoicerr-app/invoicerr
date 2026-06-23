import { FileText, Repeat } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { InvoiceStatus, type Invoice } from "@/types"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useState } from "react"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"

interface InvoiceProgressionProps {
    invoices: Invoice[]
    onSend?: (invoice: Invoice) => void
    onResend?: (invoice: Invoice) => void
    onPaymentReceived?: (invoice: Invoice) => void
    onArchive?: (invoice: Invoice) => void
    onViewInvoice?: (invoice: Invoice) => void
}

interface PipelineStep {
    key: string
    labelKey: string
    exists: boolean
    status?: InvoiceStatus
}

type ProgressionAction = "send" | "resend" | "paymentReceived" | "archive"

const pipeline: PipelineStep[] = [
    { key: "draft", labelKey: "draft", exists: true, status: InvoiceStatus.DRAFT },
    { key: "sent", labelKey: "sent", exists: true, status: InvoiceStatus.SENT },
    { key: "paid", labelKey: "paid", exists: true, status: InvoiceStatus.PAID },
    { key: "archived", labelKey: "archived", exists: false },
]

function getCurrentStepIndex(invoice: Invoice): number {
    for (let i = pipeline.length - 1; i >= 0; i--) {
        const step = pipeline[i]
        if (step.exists && step.status === invoice.status) {
            return i
        }
    }
    return -1
}

function getInvoiceActions(
    invoice: Invoice,
    handlers: Pick<InvoiceProgressionProps, "onSend" | "onResend" | "onPaymentReceived" | "onArchive">,
): { action: ProgressionAction; label: string }[] {
    const currentStep = pipeline[getCurrentStepIndex(invoice)]
    if (!currentStep?.exists) return []

    switch (currentStep.key) {
        case "draft":
            return handlers.onSend
                ? [{ action: "send", label: "invoices.progression.actions.send" }]
                : []
        case "sent":
            return [
                ...(handlers.onResend
                    ? [{ action: "resend" as const, label: "invoices.progression.actions.resend" }]
                    : []),
                ...(handlers.onPaymentReceived
                    ? [{ action: "paymentReceived" as const, label: "invoices.progression.actions.paymentReceived" }]
                    : []),
            ]
        case "paid":
            return handlers.onArchive
                ? [{ action: "archive", label: "invoices.progression.actions.archive" }]
                : []
        default:
            return []
    }
}

export function InvoiceProgression({
    invoices,
    onSend,
    onResend,
    onPaymentReceived,
    onArchive,
    onViewInvoice,
}: InvoiceProgressionProps) {
    const { t } = useTranslation()
    const handlers = { onSend, onResend, onPaymentReceived, onArchive }

    const [confirmDialog, setConfirmDialog] = useState<{
        invoice: Invoice
        action: ProgressionAction
    } | null>(null)

    const handleConfirm = () => {
        if (!confirmDialog) return

        const { invoice, action } = confirmDialog
        switch (action) {
            case "send":
                onSend?.(invoice)
                break
            case "resend":
                onResend?.(invoice)
                break
            case "paymentReceived":
                onPaymentReceived?.(invoice)
                break
            case "archive":
                onArchive?.(invoice)
                break
        }
        setConfirmDialog(null)
    }

    const invoiceLabel = confirmDialog
        ? confirmDialog.invoice.rawNumber || confirmDialog.invoice.number.toString()
        : ""
    const clientName = confirmDialog
        ? confirmDialog.invoice.client.name ||
          `${confirmDialog.invoice.client.contactFirstname} ${confirmDialog.invoice.client.contactLastname}`
        : ""

    return (
        <>
            <Card className="gap-0">
            <CardHeader className="border-b">
                <CardTitle className="flex items-center gap-2 text-base font-medium">
                    <Repeat className="h-5 w-5 text-primary" />
                    {t("invoices.progression.title")}
                </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
                {invoices.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                        <FileText className="mx-auto h-10 w-10 mb-3 opacity-50" />
                        <p>{t("invoices.progression.emptyState")}</p>
                    </div>
                ) : (
                    <div className="divide-y">
                        {invoices.map((invoice) => {
                            const currentIndex = getCurrentStepIndex(invoice)
                            const actions = getInvoiceActions(invoice, handlers)

                            return (
                                <div
                                    key={invoice.id}
                                    className="py-4 sm:py-6 px-4 sm:px-8 lg:px-12 grid grid-cols-1 lg:grid-cols-[200px_1fr_200px] items-center gap-3"
                                >
                                    <div className="min-w-0">
                                        <button
                                            type="button"
                                            onClick={() => onViewInvoice?.(invoice)}
                                            className="font-medium text-foreground hover:text-primary hover:underline text-left"
                                        >
                                            {invoice.rawNumber || invoice.number}
                                        </button>
                                        <p className="text-sm text-muted-foreground truncate">
                                            {invoice.client.name ||
                                                `${invoice.client.contactFirstname} ${invoice.client.contactLastname}`}
                                        </p>
                                    </div>

                                    <div className="overflow-x-auto">
                                        <div className="flex items-center justify-center min-w-max">
                                            {pipeline.map((step, index) => {
                                                const isPast = currentIndex > index
                                                const isCurrent = currentIndex === index
                                                const isFuture = currentIndex < index

                                                return (
                                                    <div key={step.key} className="flex items-center">
                                                        <div
                                                            className={cn(
                                                                "relative flex items-center justify-center px-2.5 py-2 rounded-lg text-xs font-bold min-w-[84px] text-center uppercase tracking-wide transition-all",
                                                                isPast &&
                                                                    step.exists &&
                                                                    "bg-emerald-500 text-white shadow-sm",
                                                                isCurrent &&
                                                                    step.exists &&
                                                                    "bg-blue-600 text-white shadow-md ring-2 ring-blue-300 ring-offset-1",
                                                                isFuture &&
                                                                    step.exists &&
                                                                    "bg-slate-200 text-slate-500",
                                                                !step.exists &&
                                                                    "text-slate-400 border border-dashed border-slate-300",
                                                                !step.exists &&
                                                                    isCurrent &&
                                                                    "ring-2 ring-blue-300 ring-offset-1",
                                                            )}
                                                            style={
                                                                !step.exists
                                                                    ? {
                                                                          background:
                                                                              "repeating-linear-gradient(45deg, #cbd5e1, #cbd5e1 6px, #f1f5f9 6px, #f1f5f9 12px)",
                                                                      }
                                                                    : undefined
                                                            }
                                                        >
                                                            {t(
                                                                `invoices.progression.steps.${step.labelKey}`,
                                                            )}
                                                        </div>

                                                        {index < pipeline.length - 1 && (
                                                            <div
                                                                className={cn(
                                                                    "w-3 h-1 flex-shrink-0 rounded-full",
                                                                    isPast || isCurrent
                                                                        ? "bg-emerald-400"
                                                                        : "bg-slate-200",
                                                                )}
                                                            />
                                                        )}
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>

                                    <div className="flex justify-start lg:justify-end items-center gap-2 flex-wrap">
                                        {actions.length > 0 ? (
                                            actions.map((action) => (
                                                <Button
                                                    key={action.action}
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-8 text-xs px-3 whitespace-nowrap"
                                                    onClick={() =>
                                                        setConfirmDialog({ invoice, action: action.action })
                                                    }
                                                >
                                                    {t(action.label)}
                                                </Button>
                                            ))
                                        ) : (
                                            <span className="text-xs text-muted-foreground italic h-8 flex items-center">
                                                {t("invoices.progression.noAction")}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </CardContent>
        </Card>

            <AlertDialog open={!!confirmDialog} onOpenChange={() => setConfirmDialog(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {confirmDialog &&
                                t(`invoices.progression.confirmations.${confirmDialog.action}.title`)}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {confirmDialog &&
                                t(
                                    `invoices.progression.confirmations.${confirmDialog.action}.description`,
                                    {
                                        number: invoiceLabel,
                                        client: clientName,
                                    },
                                )}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => setConfirmDialog(null)}>
                            {t("invoices.progression.confirmations.cancel")}
                        </AlertDialogCancel>
                        <AlertDialogAction onClick={handleConfirm}>
                            {t("invoices.progression.confirmations.confirm")}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}
