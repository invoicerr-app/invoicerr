import { FileText, Repeat } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { InvoiceStatus, getDisplayInvoiceStatus, type Invoice } from "@/types"
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
    onUnarchive?: (invoice: Invoice) => void
    onViewInvoice?: (invoice: Invoice) => void
}

interface PipelineStep {
    key: string
    labelKey: string
    exists: boolean
    status?: InvoiceStatus
}

type ProgressionAction = "send" | "resend" | "paymentReceived" | "archive" | "unarchive"

const pipeline: PipelineStep[] = [
    { key: "draft", labelKey: "draft", exists: true, status: InvoiceStatus.DRAFT },
    { key: "sent", labelKey: "sent", exists: true, status: InvoiceStatus.SENT },
    { key: "paid", labelKey: "paid", exists: true, status: InvoiceStatus.PAID },
    { key: "archived", labelKey: "archived", exists: true, status: InvoiceStatus.ARCHIVED },
]

const stepColors: Record<string, { dot: string; text: string; bar: string }> = {
    draft: { dot: "bg-slate-400", text: "text-slate-400", bar: "bg-slate-400" },
    sent: { dot: "bg-blue-500", text: "text-blue-500", bar: "bg-blue-500" },
    paid: { dot: "bg-emerald-500", text: "text-emerald-500", bar: "bg-emerald-500" },
    archived: { dot: "bg-slate-400", text: "text-slate-400", bar: "bg-slate-400" },
}

const neutralColors = { dot: "bg-slate-400", text: "text-slate-400", bar: "bg-slate-400" }

function getCurrentStepIndex(invoice: Invoice): number {
    const displayStatus = getDisplayInvoiceStatus(invoice.status)
    for (let i = pipeline.length - 1; i >= 0; i--) {
        const step = pipeline[i]
        if (step.exists && step.status === displayStatus) {
            return i
        }
    }
    return -1
}

function getInvoiceActions(
    invoice: Invoice,
    handlers: Pick<InvoiceProgressionProps, "onSend" | "onResend" | "onPaymentReceived" | "onArchive" | "onUnarchive">,
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
        case "archived":
            return handlers.onUnarchive
                ? [{ action: "unarchive", label: "invoices.progression.actions.unarchive" }]
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
    onUnarchive,
    onViewInvoice,
}: InvoiceProgressionProps) {
    const { t } = useTranslation()
    const handlers = { onSend, onResend, onPaymentReceived, onArchive, onUnarchive }

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
            case "unarchive":
                onUnarchive?.(invoice)
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
                            const currentStep = currentIndex >= 0 ? pipeline[currentIndex] : undefined
                            const colors = currentStep ? stepColors[currentStep.key] ?? neutralColors : neutralColors
                            const statusLabel = currentStep
                                ? t(`invoices.progression.steps.${currentStep.labelKey}`)
                                : t(`invoices.list.status.${invoice.status.toLowerCase()}`)
                            const filledSteps = currentIndex >= 0 ? currentIndex + 1 : 0

                            return (
                                <div
                                    key={invoice.id}
                                    className="py-4 sm:py-5 px-4 sm:px-8 lg:px-12 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
                                >
                                    <div className="min-w-0 sm:w-44 sm:flex-shrink-0">
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

                                    <div className="flex-1 min-w-0 sm:max-w-md">
                                        <div className="flex items-center justify-between gap-3 mb-2">
                                            <span className={cn("inline-flex items-center gap-2 text-sm font-semibold", colors.text)}>
                                                <span className={cn("h-2 w-2 rounded-full flex-shrink-0", colors.dot)} />
                                                {statusLabel}
                                            </span>
                                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                                                {t("invoices.progression.stepLabel", {
                                                    current: filledSteps,
                                                    total: pipeline.length,
                                                })}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            {pipeline.map((step, index) => (
                                                <div
                                                    key={step.key}
                                                    className={cn(
                                                        "h-1.5 flex-1 rounded-full transition-colors",
                                                        index < filledSteps ? colors.bar : "bg-muted",
                                                    )}
                                                />
                                            ))}
                                        </div>
                                    </div>

                                    <div className="flex justify-start sm:justify-end items-center gap-2 flex-wrap sm:w-[210px] sm:flex-shrink-0">
                                        {actions.length > 0 ? (
                                            actions.map((action, index) => (
                                                <Button
                                                    key={action.action}
                                                    variant={index === actions.length - 1 ? "default" : "outline"}
                                                    size="sm"
                                                    className={cn(
                                                        "h-8 text-xs px-3 whitespace-nowrap",
                                                        index === actions.length - 1 &&
                                                            "bg-blue-600 text-white hover:bg-blue-700",
                                                    )}
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
