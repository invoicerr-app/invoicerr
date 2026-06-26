import { FileText, Repeat } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { QuoteStatus, type Quote } from "@/types"
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

interface QuoteProgressionProps {
    quotes: Quote[]
    onSend?: (quote: Quote) => void
    onResend?: (quote: Quote) => void
    onCreateInvoice?: (quote: Quote) => void
    onViewQuote?: (quote: Quote) => void
    invoicingStatuses?: Record<string, number>
}

interface PipelineStep {
    key: string
    labelKey: string
    exists: boolean
    status?: QuoteStatus
}

type ProgressionAction = "send" | "resend" | "createInvoice"

const pipeline: PipelineStep[] = [
    { key: "draft", labelKey: "draft", exists: true, status: QuoteStatus.DRAFT },
    { key: "sent", labelKey: "sent", exists: true, status: QuoteStatus.SENT },
    { key: "signed", labelKey: "signed", exists: true, status: QuoteStatus.SIGNED },
]

const stepColors: Record<string, { dot: string; text: string; bar: string }> = {
    draft: { dot: "bg-slate-400", text: "text-slate-400", bar: "bg-slate-400" },
    sent: { dot: "bg-blue-500", text: "text-blue-500", bar: "bg-blue-500" },
    signed: { dot: "bg-emerald-500", text: "text-emerald-500", bar: "bg-emerald-500" },
}

const neutralColors = { dot: "bg-slate-400", text: "text-slate-400", bar: "bg-slate-400" }

function getCurrentStepIndex(quote: Quote): number {
    // VIEWED is positioned as SENT in the pipeline (same as UNPAID -> SENT for invoices)
    const displayStatus = quote.status === QuoteStatus.VIEWED ? QuoteStatus.SENT : quote.status
    for (let i = pipeline.length - 1; i >= 0; i--) {
        const step = pipeline[i]
        if (step.exists && step.status === displayStatus) {
            return i
        }
    }
    return -1
}

function getQuoteActions(
    quote: Quote,
    handlers: Pick<QuoteProgressionProps, "onSend" | "onResend" | "onCreateInvoice">,
    invoicingStatuses?: Record<string, number>,
): { action: ProgressionAction; label: string }[] {
    const currentStep = pipeline[getCurrentStepIndex(quote)]
    if (!currentStep?.exists) return []

    switch (currentStep.key) {
        case "draft":
            return handlers.onSend
                ? [{ action: "send", label: "quotes.progression.actions.send" }]
                : []
        case "sent":
            return handlers.onResend
                ? [{ action: "resend", label: "quotes.progression.actions.resend" }]
                : []
        case "signed":
            if (invoicingStatuses?.[quote.id] !== undefined && invoicingStatuses[quote.id] <= 0) {
                return []
            }
            return handlers.onCreateInvoice
                ? [{ action: "createInvoice", label: "quotes.progression.actions.createInvoice" }]
                : []
        default:
            return []
    }
}

export function QuoteProgression({
    quotes,
    onSend,
    onResend,
    onCreateInvoice,
    onViewQuote,
    invoicingStatuses,
}: QuoteProgressionProps) {
    const { t } = useTranslation()
    const handlers = { onSend, onResend, onCreateInvoice }

    const [confirmDialog, setConfirmDialog] = useState<{
        quote: Quote
        action: ProgressionAction
    } | null>(null)

    const handleConfirm = () => {
        if (!confirmDialog) return

        const { quote, action } = confirmDialog
        switch (action) {
            case "send":
                onSend?.(quote)
                break
            case "resend":
                onResend?.(quote)
                break
            case "createInvoice":
                onCreateInvoice?.(quote)
                break
        }
        setConfirmDialog(null)
    }

    const quoteLabel = confirmDialog
        ? confirmDialog.quote.rawNumber || (confirmDialog.quote.number?.toString() ?? "")
        : ""
    const clientName = confirmDialog
        ? confirmDialog.quote.client.name ||
          `${confirmDialog.quote.client.contactFirstname} ${confirmDialog.quote.client.contactLastname}`
        : ""
    const clientEmail = confirmDialog?.quote.client.contactEmail || ""
    const showRecipient =
        !!confirmDialog && (confirmDialog.action === "send" || confirmDialog.action === "resend") && !!clientEmail

    return (
        <>
            <Card className="gap-0">
            <CardHeader className="border-b">
                <CardTitle className="flex items-center gap-2 text-base font-medium">
                    <Repeat className="h-5 w-5 text-primary" />
                    {t("quotes.progression.title")}
                </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
                {quotes.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                        <FileText className="mx-auto h-10 w-10 mb-3 opacity-50" />
                        <p>{t("quotes.progression.emptyState")}</p>
                    </div>
                ) : (
                    <div className="divide-y">
                        {quotes.map((quote) => {
                            const currentIndex = getCurrentStepIndex(quote)
                            const actions = getQuoteActions(quote, handlers, invoicingStatuses)
                            const currentStep = currentIndex >= 0 ? pipeline[currentIndex] : undefined
                            const colors = currentStep ? stepColors[currentStep.key] ?? neutralColors : neutralColors
                            const statusLabel = currentStep
                                ? t(`quotes.progression.steps.${currentStep.labelKey}`)
                                : t(`quotes.list.status.${quote.status.toLowerCase()}`)
                            const filledSteps = currentIndex >= 0 ? currentIndex + 1 : 0

                            return (
                                <div
                                    key={quote.id}
                                    data-cy="quote-progression-row"
                                    className="py-4 sm:py-5 px-4 sm:px-8 lg:px-12 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
                                >
                                    <div className="min-w-0 sm:w-44 sm:flex-shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => onViewQuote?.(quote)}
                                            className="font-medium text-foreground hover:text-primary hover:underline text-left"
                                        >
                                            {quote.rawNumber || quote.number}
                                        </button>
                                        <p className="text-sm text-muted-foreground truncate">
                                            {quote.client.name ||
                                                `${quote.client.contactFirstname} ${quote.client.contactLastname}`}
                                        </p>
                                    </div>

                                    <div className="flex-1 min-w-0 sm:max-w-md">
                                        <div className="flex items-center justify-between gap-3 mb-2">
                                            <span className={cn("inline-flex items-center gap-2 text-sm font-semibold", colors.text)}>
                                                <span className={cn("h-2 w-2 rounded-full flex-shrink-0", colors.dot)} />
                                                {statusLabel}
                                            </span>
                                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                                                {t("quotes.progression.stepLabel", {
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
                                                    dataCy={`quote-progression-${action.action}`}
                                                    className={cn(
                                                        "h-8 text-xs px-3 whitespace-nowrap",
                                                        index === actions.length - 1 &&
                                                            "bg-blue-600 text-white hover:bg-blue-700",
                                                    )}
                                                    onClick={() =>
                                                        action.action === "createInvoice"
                                                            ? onCreateInvoice?.(quote)
                                                            : setConfirmDialog({ quote, action: action.action })
                                                    }
                                                >
                                                    {t(action.label)}
                                                </Button>
                                            ))
                                        ) : (
                                            <span className="text-xs text-muted-foreground italic h-8 flex items-center">
                                                {t("quotes.progression.noAction")}
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
                                t(`quotes.progression.confirmations.${confirmDialog.action}.title`)}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {confirmDialog &&
                                t(
                                    `quotes.progression.confirmations.${confirmDialog.action}.description`,
                                    {
                                        number: quoteLabel,
                                        client: clientName,
                                    },
                                )}
                        </AlertDialogDescription>
                        {showRecipient && (
                            <p className="text-sm mt-2">
                                <span className="text-muted-foreground">{t("quotes.sendConfirmation.emailLabel")}</span>{" "}
                                {clientEmail}
                            </p>
                        )}
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => setConfirmDialog(null)}>
                            {t("quotes.progression.confirmations.cancel")}
                        </AlertDialogCancel>
                        <AlertDialogAction data-cy="quote-progression-confirm-action" onClick={handleConfirm}>
                            {t("quotes.progression.confirmations.confirm")}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}
