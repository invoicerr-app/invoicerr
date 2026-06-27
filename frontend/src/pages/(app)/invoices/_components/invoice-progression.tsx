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
import { PaymentReceivedDialog } from "./payment-received-dialog"

interface InvoiceProgressionProps {
    invoices: Invoice[]
    onIssue?: (invoice: Invoice) => void
    onSend?: (invoice: Invoice) => void
    onResend?: (invoice: Invoice) => void
    onArchive?: (invoice: Invoice) => void
    onViewInvoice?: (invoice: Invoice) => void
}

type ProgressionAction = "issue" | "send" | "resend" | "paymentReceived" | "archive"

const STEP_REGISTRY: Record<string, { labelKey: string; status: InvoiceStatus }> = {
    draft: { labelKey: "draft", status: InvoiceStatus.DRAFT },
    issued: { labelKey: "issued", status: InvoiceStatus.ISSUED },
    pending_clearance: { labelKey: "pendingClearance", status: InvoiceStatus.PENDING_CLEARANCE },
    cleared: { labelKey: "cleared", status: InvoiceStatus.CLEARED },
    delivered: { labelKey: "delivered", status: InvoiceStatus.SENT },
    sent: { labelKey: "sent", status: InvoiceStatus.SENT },
    paid: { labelKey: "paid", status: InvoiceStatus.PAID },
    archived: { labelKey: "archived", status: InvoiceStatus.ARCHIVED },
}

const DEFAULT_PIPELINE = ["draft", "issued", "sent", "paid", "archived"]

function pipelineFor(invoice: Invoice): { key: string; labelKey: string; status: InvoiceStatus }[] {
    const keys = invoice.complianceDocuments?.[0]?.flow?.pipeline ?? DEFAULT_PIPELINE
    return keys.filter((k) => STEP_REGISTRY[k]).map((k) => ({ key: k, ...STEP_REGISTRY[k] }))
}

const stepColors: Record<string, { dot: string; text: string; bar: string }> = {
    draft: { dot: "bg-slate-400", text: "text-slate-400", bar: "bg-slate-400" },
    issued: { dot: "bg-violet-500", text: "text-violet-500", bar: "bg-violet-500" },
    pending_clearance: { dot: "bg-sky-500", text: "text-sky-500", bar: "bg-sky-500" },
    cleared: { dot: "bg-teal-500", text: "text-teal-500", bar: "bg-teal-500" },
    delivered: { dot: "bg-blue-500", text: "text-blue-500", bar: "bg-blue-500" },
    sent: { dot: "bg-blue-500", text: "text-blue-500", bar: "bg-blue-500" },
    paid: { dot: "bg-emerald-500", text: "text-emerald-500", bar: "bg-emerald-500" },
    archived: { dot: "bg-slate-400", text: "text-slate-400", bar: "bg-slate-400" },
    cancelled: { dot: "bg-red-500", text: "text-red-500", bar: "bg-red-500" },
    corrected: { dot: "bg-amber-500", text: "text-amber-500", bar: "bg-amber-500" },
}

const neutralColors = { dot: "bg-slate-400", text: "text-slate-400", bar: "bg-slate-400" }

const partiallyPaidColors = { dot: "bg-amber-500", text: "text-amber-500", bar: "bg-amber-500" }

function getAlreadyPaid(invoice: Invoice): number {
    return invoice.payments?.reduce((sum, p) => sum + p.totalPaid, 0) ?? 0
}

function getCurrentStepIndex(invoice: Invoice, steps: { status: InvoiceStatus }[]): number {
    const displayStatus = getDisplayInvoiceStatus(invoice.status)
    for (let i = steps.length - 1; i >= 0; i--) {
        if (steps[i].status === displayStatus) return i
    }
    return -1
}

function getInvoiceActions(
    invoice: Invoice,
    steps: { key: string; status: InvoiceStatus }[],
    handlers: Pick<InvoiceProgressionProps, "onIssue" | "onSend" | "onResend" | "onArchive">,
): { action: ProgressionAction; label: string }[] {
    const idx = getCurrentStepIndex(invoice, steps)
    const currentKey = idx >= 0 ? steps[idx].key : undefined
    if (!currentKey) return []

    const sendLabel = invoice.complianceDocuments?.[0]?.flow?.sendLabelKey
        ? `invoices.view.actions.${invoice.complianceDocuments![0].flow!.sendLabelKey}`
        : "invoices.progression.actions.send"

    switch (currentKey) {
        case "draft":
            return handlers.onIssue
                ? [{ action: "issue", label: "invoices.progression.actions.issue" }]
                : []
        case "issued":
        case "cleared":
            return handlers.onSend
                ? [{ action: "send", label: sendLabel }]
                : []
        case "pending_clearance":
            return []
        case "delivered":
        case "sent":
            return [
                ...(handlers.onResend
                    ? [{ action: "resend" as const, label: "invoices.progression.actions.resend" }]
                    : []),
                { action: "paymentReceived" as const, label: "invoices.progression.actions.paymentReceived" },
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
    onIssue,
    onSend,
    onResend,
    onArchive,
    onViewInvoice,
}: InvoiceProgressionProps) {
    const { t } = useTranslation()
    const handlers = { onIssue, onSend, onResend, onArchive }

    const [confirmDialog, setConfirmDialog] = useState<{
        invoice: Invoice
        action: ProgressionAction
    } | null>(null)
    const [paymentDialogInvoice, setPaymentDialogInvoice] = useState<Invoice | null>(null)

    const handleConfirm = () => {
        if (!confirmDialog) return

        const { invoice, action } = confirmDialog
        switch (action) {
            case "issue":
                onIssue?.(invoice)
                break
            case "send":
                onSend?.(invoice)
                break
            case "resend":
                onResend?.(invoice)
                break
            case "archive":
                onArchive?.(invoice)
                break
        }
        setConfirmDialog(null)
    }

    const invoiceLabel = confirmDialog
        ? confirmDialog.invoice.rawNumber || confirmDialog.invoice.number?.toString() || "DRAFT"
        : ""
    const clientName = confirmDialog
        ? confirmDialog.invoice.client.name ||
          `${confirmDialog.invoice.client.contactFirstname} ${confirmDialog.invoice.client.contactLastname}`
        : ""
    const clientEmail = confirmDialog?.invoice.client.contactEmail || ""
    const showRecipient =
        !!confirmDialog && (confirmDialog.action === "send" || confirmDialog.action === "resend") && !!clientEmail

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
                            const steps = pipelineFor(invoice)
                            const currentIndex = getCurrentStepIndex(invoice, steps)
                            const actions = getInvoiceActions(invoice, steps, handlers)
                            const currentStep = currentIndex >= 0 ? steps[currentIndex] : undefined
                            const alreadyPaid = getAlreadyPaid(invoice)
                            const isPartiallyPaid = (currentStep?.key === "sent" || currentStep?.key === "delivered") && alreadyPaid > 0
                            const percentPaid = invoice.totalTTC > 0 ? Math.min(100, Math.round((alreadyPaid / invoice.totalTTC) * 100)) : 0
                            const colors = isPartiallyPaid
                                ? partiallyPaidColors
                                : currentStep
                                ? stepColors[currentStep.key] ?? neutralColors
                                : neutralColors
                            const statusLabel = isPartiallyPaid
                                ? `${t("invoices.progression.steps.partiallyPaid")} (${t("invoices.progression.percentPaid", { percent: percentPaid })})`
                                : currentStep
                                ? t(`invoices.progression.steps.${currentStep.labelKey}`)
                                : t(`invoices.list.status.${invoice.status.toLowerCase()}`)
                            const filledSteps = currentIndex >= 0 ? currentIndex + 1 : 0

                            return (
                                <div
                                    key={invoice.id}
                                    data-cy="invoice-progression-row"
                                    className="py-4 sm:py-5 px-4 sm:px-8 lg:px-12 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
                                >
                                    <div className="min-w-0 sm:w-44 sm:flex-shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => onViewInvoice?.(invoice)}
                                            className="font-medium text-foreground hover:text-primary hover:underline text-left"
                                        >
                                            {invoice.rawNumber || invoice.number || t("invoices.progression.noNumberYet")}
                                        </button>
                                        <p className="text-sm text-muted-foreground truncate">
                                            {invoice.client.name ||
                                                `${invoice.client.contactFirstname} ${invoice.client.contactLastname}`}
                                        </p>
                                        {(() => {
                                            const cs = invoice.complianceDocuments?.[0]?.status
                                            if (!cs || cs === 'DRAFT' || cs === 'ISSUED') return null
                                            const dotColor =
                                                ['CLEARED','DELIVERED','ACCEPTED','REPORTED'].includes(cs) ? 'bg-emerald-500' :
                                                ['PENDING_CLEARANCE','AWAITING_RESPONSE','DISPUTED','CONTINGENCY'].includes(cs) ? 'bg-amber-500' :
                                                ['REJECTED','REFUSED','CANCELLED'].includes(cs) ? 'bg-red-500' : 'bg-slate-400'
                                            return (
                                                <span className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                                                    <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${dotColor}`} />
                                                    {cs.replace(/_/g, ' ')}
                                                </span>
                                            )
                                        })()}
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
                                                    total: steps.length,
                                                })}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            {steps.map((step, index) => (
                                                <div
                                                    key={step.key}
                                                    className={cn(
                                                        "h-1.5 flex-1 rounded-full transition-colors overflow-hidden relative",
                                                        index < filledSteps ? colors.bar : "bg-muted",
                                                    )}
                                                >
                                                    {isPartiallyPaid && step.key === "paid" && (
                                                        <div
                                                            className={cn("absolute inset-y-0 left-0 rounded-full", partiallyPaidColors.bar)}
                                                            style={{ width: `${percentPaid}%` }}
                                                        />
                                                    )}
                                                </div>
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
                                                    dataCy={`invoice-progression-${action.action}`}
                                                    className={cn(
                                                        "h-8 text-xs px-3 whitespace-nowrap",
                                                        index === actions.length - 1 &&
                                                            "bg-blue-600 text-white hover:bg-blue-700",
                                                    )}
                                                    onClick={() =>
                                                        action.action === "paymentReceived"
                                                            ? setPaymentDialogInvoice(invoice)
                                                            : setConfirmDialog({ invoice, action: action.action })
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
                        {showRecipient && (
                            <p className="text-sm mt-2">
                                <span className="text-muted-foreground">{t("invoices.sendConfirmation.emailLabel")}</span>{" "}
                                {clientEmail}
                            </p>
                        )}
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => setConfirmDialog(null)}>
                            {t("invoices.progression.confirmations.cancel")}
                        </AlertDialogCancel>
                        <AlertDialogAction data-cy="invoice-progression-confirm-action" onClick={handleConfirm}>
                            {t("invoices.progression.confirmations.confirm")}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <PaymentReceivedDialog
                invoice={paymentDialogInvoice}
                onOpenChange={(open) => {
                    if (!open) setPaymentDialogInvoice(null)
                }}
            />
        </>
    )
}
