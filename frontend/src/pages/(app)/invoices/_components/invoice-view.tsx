import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

import type { Invoice } from "@/types"
import {
  DocumentKind,
  InvoiceStatus,
  PaymentMethodType,
  getDisplayInvoiceStatus,
  getInvoiceKindLabel,
  getInvoiceKindColor,
} from "@/types"
import { format } from "date-fns"
import { languageToLocale } from "@/lib/i18n"
import { formatAmount } from "@/lib/utils"
import { getDraftWatermarkLabel } from "@/lib/watermark"
import { useTranslation } from "react-i18next"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useAvailableActions } from "@/hooks/queries/use-available-actions"
import { ArchivalPanel, CancellationPolicyPanel, ObligationLayersPanel } from "./compliance-panels"
import { useGet } from "@/hooks/use-fetch"
import { authenticatedFetch } from "@/hooks/use-fetch"
import { toast } from "sonner"
import {
  AlertTriangle,
  Edit,
  RefreshCw,
  RotateCcw,
  XCircle,
  Send,
  ArrowRightLeft,
  Banknote,
  Printer,
  UploadCloud,
  Clock,
} from "lucide-react"
/**
 * F-008 — the three outcomes that must be readable without scrolling to the compliance timeline at
 * the bottom of the page. Before this, an invoice rejected by KSeF, refused by its buyer, or never
 * transmitted at all showed "Sent" at the top, and the failure appeared only as one line in a list
 * the user had no reason to open.
 *
 * Driven by Invoice.status, which the backend projects from the compliance document, so the banner
 * and the status badge can never disagree. Three entries rather than one because a user acts
 * differently on each: a rejection is terminal, a refusal is answered with a corrective invoice,
 * and a transmission failure is retried.
 */
const FAILURE_BANNERS: Partial<
  Record<InvoiceStatus, { key: string; tone: string; icon: string; title: string; body: string }>
> = {
  [InvoiceStatus.REJECTED]: {
    key: "invoices.view.rejected",
    tone: "border-red-200 bg-red-50",
    icon: "text-red-600",
    title: "text-red-800",
    body: "text-red-700",
  },
  [InvoiceStatus.REFUSED]: {
    key: "invoices.view.refused",
    tone: "border-red-200 bg-red-50",
    icon: "text-red-600",
    title: "text-red-800",
    body: "text-red-700",
  },
  [InvoiceStatus.TRANSMISSION_FAILED]: {
    key: "invoices.view.transmissionFailed",
    tone: "border-orange-200 bg-orange-50",
    icon: "text-orange-600",
    title: "text-orange-800",
    body: "text-orange-700",
  },
}

import { DepositDialog } from "./deposit-dialog"
import { useState } from "react"

interface InvoiceViewDialogProps {
  invoice: Invoice | null
  onOpenChange: (open: boolean) => void
  onMutate?: () => void
  /**
   * Open another invoice in place of this one.
   *
   * Used after a correction: the draft it produces is the thing the user now has to finish, and
   * sending them back to a list to find it is asking them to remember what just happened. Odoo lands
   * you on the draft credit note for the same reason.
   */
  onOpenInvoice?: (invoiceId: string) => void
  /**
   * Open the edit form for the invoice being viewed.
   *
   * Without it the Edit button only CLOSED the dialog — a dead control that looked like a feature.
   * A UI-driven test found it; an API-driven one never could, because the endpoint was fine all
   * along and nobody could reach it from here.
   *
   * LIMIT, named rather than hidden: the progression view mounts this dialog without an edit form of
   * its own, so the button there still only closes. Editing lives in the list view, which is where
   * this is wired. Giving progression its own form is a change to that view, not to this one.
   */
  onEditInvoice?: (invoice: Invoice) => void
}

export function InvoiceViewDialog({
  invoice,
  onOpenChange,
  onMutate,
  onOpenInvoice,
  onEditInvoice,
}: InvoiceViewDialogProps) {
  const { t, i18n } = useTranslation()
  const { data: actions } = useAvailableActions(invoice?.id)
  const [depositOpen, setDepositOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [retryingTransmission, setRetryingTransmission] = useState(false)

  // Fetch the original invoice when this one corrects another
  const { data: originalInvoice } = useGet<Invoice>(
    invoice?.correctsInvoiceId ? `/api/invoices/${invoice.correctsInvoiceId}` : null,
  )

  /**
   * F-008: this dialog is opened with the row object from the invoice LIST, and
   * `GET /api/invoices` selects `complianceDocuments: { id, status, plan }` — no events. So
   * `invoice.complianceDocuments[0].events` was always undefined here: the compliance timeline
   * below rendered nothing, and the failure banner could show that an invoice was rejected but
   * never why.
   *
   * `GET /api/invoices/:id` already selects the events with their `detail`. Fetching it and
   * preferring it when it arrives fixes both, without changing the list payload for every row.
   * Falls back to the list row while in flight, so the dialog still opens instantly.
   */
  const { data: fullInvoice } = useGet<Invoice>(invoice ? `/api/invoices/${invoice.id}` : null)
  const detailed = fullInvoice ?? invoice

  if (!invoice) return null

  const formatDate = (date?: string) =>
    date ? format(new Date(date), "PPP", { locale: languageToLocale(i18n.language) }) : "—"
  const discountRateValue = Number(invoice.discountRate ?? 0)
  const subtotalBeforeDiscount =
    invoice.items?.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0) ?? 0
  const discountAmount = Math.max(0, subtotalBeforeDiscount - invoice.totalHT)

  const getStatusLabel = (status: string) => {
    return t(`invoices.view.status.${getDisplayInvoiceStatus(status).toLowerCase()}`)
  }

  const kindLabel = getInvoiceKindLabel(invoice.kind)
  const kindColor = getInvoiceKindColor(invoice.kind)
  const isCorrection =
    invoice.kind === DocumentKind.CREDIT_NOTE ||
    invoice.kind === DocumentKind.CORRECTIVE_INVOICE ||
    invoice.kind === DocumentKind.DEBIT_NOTE
  const correctedBy = invoice.correctedBy ?? []

  const handleAction = (action: string, kind?: DocumentKind) => {
    if (!invoice) return
    const url =
      action === "cancelAndReplace"
        ? `/api/invoices/${invoice.id}/cancel-and-replace`
        : action === "convertToInvoice"
          ? `/api/invoices/${invoice.id}/convert-to-invoice`
          : action === "send"
            ? `/api/invoices/send`
            : `/api/invoices/${invoice.id}/${action}`
    // `correct` now carries WHICH document to issue. Without it the server falls back to the
    // country's primary model — which is why both correction buttons used to do the same thing.
    const body =
      action === "send"
        ? JSON.stringify({ id: invoice.id })
        : action === "correct" && kind
          ? JSON.stringify({ kind })
          : JSON.stringify({})

    authenticatedFetch(url, { method: "POST", body })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(data.message || data.reason || t(`invoices.view.actions.${action}Error`))
          return
        }
        if (action === "cancel" && !data.accepted) {
          toast.error(data.reason || t("invoices.list.messages.cancelError"))
        } else if (action === "send" && data.delivered === false) {
          // The document was handed to a queue, not to the customer. Saying "sent" here is how the
          // product came to announce a delivery that had failed: for every channel but plain email
          // the transmission has not been attempted yet, and the outcome lands seconds later.
          //
          // The dialog deliberately stays OPEN. Closing it on a pending outcome is what hid the
          // eventual failure — the user was returned to a list that still showed the old status.
          toast.info(t("invoices.view.actions.sendSubmitted"))
          onMutate?.()
        } else if (action === "correct" && data.correctionInvoiceId && onOpenInvoice) {
          // A correction is now a DRAFT the user still has to finish. Closing on a toast would leave
          // them with a document they must find again, and the whole point of the draft is that they
          // edit it before issuing.
          toast.success(t(`invoices.view.actions.${action}Success`))
          onMutate?.()
          onOpenInvoice(data.correctionInvoiceId as string)
        } else {
          toast.success(t(`invoices.view.actions.${action}Success`))
          onMutate?.()
          onOpenChange(false)
        }
      })
      .catch(() => {
        toast.error(t(`invoices.view.actions.${action}Error`))
      })
  }

  const handleRefreshComplianceStatus = async (compDocId: string) => {
    setRefreshing(true)
    try {
      const res = await authenticatedFetch(`/api/compliance/documents/${compDocId}/refresh`, {
        method: "POST",
      })
      if (res.ok) {
        toast.success(t("invoices.view.actions.refreshStatusSuccess", "Status refreshed"))
        onMutate?.()
      } else {
        toast.error(t("invoices.view.actions.refreshStatusError", "Failed to refresh status"))
      }
    } catch {
      toast.error(t("invoices.view.actions.refreshStatusError", "Failed to refresh status"))
    } finally {
      setRefreshing(false)
    }
  }

  // Phase 4 (QUEUE_IMPL_PLAN.md §5.10): re-enqueue transmission for a compliance document stuck in
  // TRANSMISSION_FAILED — mirrors handleRefreshComplianceStatus() above, hitting the dedicated retry
  // endpoint instead (backend/src/compliance/nest/inbound-invoice.controller.ts).
  const handleRetryTransmission = async (compDocId: string) => {
    setRetryingTransmission(true)
    try {
      const res = await authenticatedFetch(`/api/compliance/documents/${compDocId}/retry`, {
        method: "POST",
      })
      if (res.ok) {
        toast.success(t("invoices.view.actions.retryTransmissionSuccess", "Retry submitted"))
        onMutate?.()
      } else {
        const data = await res.json().catch(() => ({}))
        toast.error(data.message || t("invoices.view.actions.retryTransmissionError", "Failed to retry"))
      }
    } catch {
      toast.error(t("invoices.view.actions.retryTransmissionError", "Failed to retry"))
    } finally {
      setRetryingTransmission(false)
    }
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
            <DialogTitle className="text-xl font-semibold flex flex-wrap items-center gap-2 min-w-0 pr-8 break-words">
              {t("invoices.view.title", {
                number: invoice.rawNumber || invoice.number?.toString() || "DRAFT",
              })}
              {invoice.kind && invoice.kind !== DocumentKind.INVOICE && (
                <Badge variant="secondary" className={`text-xs ${kindColor}`}>
                  {kindLabel}
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t("invoices.view.description")}
            </DialogDescription>
          </DialogHeader>

          {FAILURE_BANNERS[invoice.status as InvoiceStatus] &&
            (() => {
              // The authority's or buyer's own wording, if one was sent. Only INBOUND_STATUS
              // signals carry text — a poll-detected failure has no motive — so an absent reason
              // is normal and is rendered as absent, never padded with a plausible sentence.
              const reason = detailed?.complianceDocuments?.[0]?.events
                ?.filter((ev) => ev.detail)
                .slice(-1)[0]?.detail
              const banner = FAILURE_BANNERS[invoice.status as InvoiceStatus]!
              return (
                <div
                  className={`mt-2 flex-shrink-0 rounded-md border p-4 ${banner.tone}`}
                  data-cy="invoice-failure-banner"
                  data-status={invoice.status}
                >
                  <div className="flex items-start gap-3">
                    <AlertTriangle className={`h-5 w-5 shrink-0 ${banner.icon}`} />
                    <div className="space-y-1 min-w-0">
                      <p className={`text-sm font-semibold ${banner.title}`}>{t(`${banner.key}.title`)}</p>
                      <p className={`text-sm ${banner.body}`}>{t(`${banner.key}.body`)}</p>
                      {reason && (
                        <p className={`text-sm break-words ${banner.body}`} data-cy="invoice-failure-reason">
                          <span className="font-medium">{t(`${banner.key}.reason`)}</span>
                          {" : "}
                          {reason}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )
            })()}

          {/* Available actions from the compliance plan */}
          {actions && (
            <div className="flex flex-wrap gap-2 flex-shrink-0" data-cy="available-actions">
              {actions.actions.edit && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onOpenChange(false)
                    if (invoice) onEditInvoice?.(invoice)
                  }}
                  data-cy="action-edit"
                >
                  <Edit className="h-3.5 w-3.5 mr-1.5" />
                  {t("invoices.view.actions.edit")}
                </Button>
              )}
              {actions.actions.correct && actions.correctionKinds.includes("CREDIT_NOTE") && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleAction("correct", DocumentKind.CREDIT_NOTE)}
                  data-cy="action-correct"
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                  {t("invoices.view.actions.creditNote")}
                </Button>
              )}
              {actions.actions.correct && actions.correctionKinds.includes("CORRECTIVE_INVOICE") && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleAction("correct", DocumentKind.CORRECTIVE_INVOICE)}
                  data-cy="action-corrective"
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                  {t("invoices.view.actions.correctiveInvoice")}
                </Button>
              )}
              {/*
                The document Italian law COMPELS and the product never offered. Art. 26 comma 1 DPR
                633/72: on any increase "le disposizioni degli articoli 21 e seguenti DEVONO ESSERE
                OSSERVATE" — an obligation, where the credit note on a decrease is only a faculty.
                It appears wherever a country's routes leave DEBIT_NOTE open, and nowhere else.
              */}
              {actions.actions.correct && actions.correctionKinds.includes("DEBIT_NOTE") && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleAction("correct", DocumentKind.DEBIT_NOTE)}
                  data-cy="action-debit-note"
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                  {t("invoices.view.actions.debitNote")}
                </Button>
              )}
              {actions.actions.cancel && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleAction("cancel")}
                  data-cy="action-cancel"
                  className="text-red-600 hover:text-red-700"
                >
                  <XCircle className="h-3.5 w-3.5 mr-1.5" />
                  {t("invoices.view.actions.cancel")}
                </Button>
              )}
              {actions.actions.cancelAndReplace && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleAction("cancelAndReplace")}
                  data-cy="action-cancel-replace"
                  className="text-red-600 hover:text-red-700"
                >
                  <XCircle className="h-3.5 w-3.5 mr-1.5" />
                  {t("invoices.view.actions.cancelAndReplace")}
                </Button>
              )}
              {actions.actions.send &&
                (() => {
                  const labelKey = actions.flow?.sendLabelKey ?? "send"
                  const Icon =
                    actions.flow?.channelClass === "PRINT"
                      ? Printer
                      : actions.flow?.channelClass === "CLEARANCE" || actions.flow?.channelClass === "PORTAL"
                        ? UploadCloud
                        : Send
                  return (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleAction("send")}
                      data-cy="action-send"
                    >
                      <Icon className="h-3.5 w-3.5 mr-1.5" />
                      {t(`invoices.view.actions.${labelKey}`)}
                    </Button>
                  )
                })()}
              {actions.actions.convertToInvoice && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleAction("convertToInvoice")}
                  data-cy="action-convert-proforma"
                >
                  <ArrowRightLeft className="h-3.5 w-3.5 mr-1.5" />
                  {t("invoices.view.actions.convertToInvoice")}
                </Button>
              )}
              {actions.actions.deposit && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDepositOpen(true)}
                  data-cy="action-deposit"
                >
                  <Banknote className="h-3.5 w-3.5 mr-1.5" />
                  {t("invoices.view.actions.deposit")}
                </Button>
              )}
            </div>
          )}

          {actions?.flow?.awaiting && (
            <div
              className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 flex-shrink-0"
              data-cy="flow-awaiting"
            >
              <Clock className="h-4 w-4 flex-shrink-0" />
              {t(
                `invoices.view.actions.awaiting${actions.flow.awaiting === "CLEARANCE" ? "Clearance" : actions.flow.awaiting === "BUYER_RESPONSE" ? "BuyerResponse" : "Delivery"}`,
              )}
            </div>
          )}

          <div className="overflow-y-auto overflow-x-hidden mt-2 flex-1 flex flex-col gap-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 bg-muted/50 p-4 rounded-lg">
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">{t("invoices.view.fields.number")}</p>
                <p className="font-medium break-words">
                  {invoice.rawNumber || invoice.number?.toString() || "DRAFT"}
                </p>
              </div>

              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">{t("invoices.view.fields.title")}</p>
                <p className="font-medium break-words">{invoice.title || "—"}</p>
              </div>

              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">{t("invoices.view.fields.status")}</p>
                <p className="font-medium break-words">{getStatusLabel(invoice.status)}</p>
              </div>

              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">{t("invoices.view.fields.createdAt")}</p>
                <p className="font-medium">{formatDate(invoice.createdAt)}</p>
              </div>

              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">{t("invoices.view.fields.dueDate")}</p>
                <p className="font-medium">{formatDate(invoice.dueDate)}</p>
              </div>

              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">{t("invoices.view.fields.paidAt")}</p>
                <p className="font-medium">{formatDate(invoice.paidAt)}</p>
              </div>

              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">{t("invoices.view.fields.updatedAt")}</p>
                <p className="font-medium">{formatDate(invoice.updatedAt)}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 bg-muted/50 p-4 rounded-lg">
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">{t("invoices.view.fields.client")}</p>
                <p className="font-medium break-words">
                  {invoice.client?.name ||
                    `${invoice.client?.contactFirstname} ${invoice.client?.contactLastname}` ||
                    invoice.clientId}
                </p>
              </div>

              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">{t("invoices.view.fields.paymentMethod")}</p>
                <p className="font-medium break-words">
                  {(() => {
                    const pm = invoice.paymentMethod
                    if (pm) {
                      return (
                        pm.name +
                        " - " +
                        (pm.type === PaymentMethodType.BANK_TRANSFER
                          ? t("paymentMethods.fields.type.bank_transfer")
                          : pm.type === PaymentMethodType.PAYPAL
                            ? t("paymentMethods.fields.type.paypal")
                            : pm.type === PaymentMethodType.CHECK
                              ? t("paymentMethods.fields.type.check")
                              : pm.type === PaymentMethodType.CASH
                                ? t("paymentMethods.fields.type.cash")
                                : pm.type === PaymentMethodType.OTHER
                                  ? t("paymentMethods.fields.type.other")
                                  : pm.type)
                      )
                    }
                    return "—"
                  })()}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 bg-muted/50 p-4 rounded-lg">
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">{t("invoices.view.fields.totalHT")}</p>
                <p className="font-medium">
                  {t("common.valueWithCurrency", {
                    currency: invoice.currency,
                    amount: formatAmount(invoice.totalHT, invoice.company?.country),
                  })}
                </p>
              </div>

              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">{t("invoices.view.fields.totalVAT")}</p>
                <p className="font-medium">
                  {t("common.valueWithCurrency", {
                    currency: invoice.currency,
                    amount: formatAmount(invoice.totalVAT, invoice.company?.country),
                  })}
                </p>
              </div>

              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">{t("invoices.view.fields.totalTTC")}</p>
                <p className="font-medium">
                  {t("common.valueWithCurrency", {
                    currency: invoice.currency,
                    amount: formatAmount(invoice.totalTTC, invoice.company?.country),
                  })}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 bg-muted/50 p-4 rounded-lg">
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">{t("invoices.view.fields.discountRate")}</p>
                <p className="font-medium">{discountRateValue.toFixed(2).replace(/\.00$/, "")}%</p>
              </div>
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">{t("invoices.view.fields.discountAmount")}</p>
                <p className="font-medium">
                  {t("common.valueWithCurrency", {
                    currency: invoice.currency,
                    amount: formatAmount(discountAmount, invoice.company?.country),
                  })}
                </p>
              </div>
            </div>

            {invoice.notes && (
              <div className="bg-muted/50 p-4 rounded-lg">
                <p className="text-sm text-muted-foreground mb-2">{t("invoices.view.fields.notes")}</p>
                <p className="font-medium break-words">{invoice.notes}</p>
              </div>
            )}

            {invoice.complianceDocuments &&
              invoice.complianceDocuments.length > 0 &&
              (() => {
                const doc = invoice.complianceDocuments![0]
                const confidence = doc.plan?.confidence
                const warnings = doc.plan?.warnings
                if (!confidence && (!warnings || warnings.length === 0)) return null
                return (
                  <div className="bg-muted/50 p-4 rounded-lg" data-cy="compliance-status">
                    <p className="text-sm text-muted-foreground mb-2">
                      {t("invoices.view.fields.complianceStatus")}
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-medium">{doc.status}</span>
                      {confidence && (
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                            confidence === "OFFICIAL"
                              ? "bg-green-100 text-green-800"
                              : confidence === "BEST_EFFORT"
                                ? "bg-yellow-100 text-yellow-800"
                                : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {confidence}
                        </span>
                      )}
                    </div>
                    {warnings && warnings.length > 0 && (
                      <ul className="mt-2 text-sm text-amber-700 list-disc list-outside pl-5">
                        {warnings.map((w, i) => (
                          <li key={i} className="break-words">
                            {w}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )
              })()}

            {/*
              F-008: the rejection has to be readable without scrolling to the compliance timeline
              at the bottom of the page. Before this, an invoice rejected by KSeF or scartata by the
              SdI showed "Sent" at the top and the rejection only appeared as one line in a list the
              user had no reason to open — so they believed they had invoiced.

              Driven by Invoice.status, which the backend now projects from the compliance document,
              rather than by the document status, so the banner and the badge can never disagree.
            */}
            {(() => {
              const compDoc = detailed?.complianceDocuments?.[0]
              if (!compDoc) return null
              const statusColors: Record<string, string> = {
                CLEARED: "text-emerald-700 bg-emerald-50",
                DELIVERED: "text-emerald-700 bg-emerald-50",
                ACCEPTED: "text-emerald-700 bg-emerald-50",
                REPORTED: "text-emerald-700 bg-emerald-50",
                ISSUED: "text-violet-700 bg-violet-50",
                PENDING_CLEARANCE: "text-amber-700 bg-amber-50",
                AWAITING_RESPONSE: "text-amber-700 bg-amber-50",
                DISPUTED: "text-amber-700 bg-amber-50",
                CONTINGENCY: "text-amber-700 bg-amber-50",
                REJECTED: "text-red-700 bg-red-50",
                REFUSED: "text-red-700 bg-red-50",
                CANCELLED: "text-red-700 bg-red-50",
                TRANSMISSION_FAILED: "text-red-700 bg-red-50",
              }
              const color = statusColors[compDoc.status] ?? "text-slate-500 bg-slate-50"
              // Phase 4 (QUEUE_IMPL_PLAN.md §5.10): TRANSMISSION_FAILED is non-terminal (retryable —
              // see flow-descriptor.ts) — swap the passive "refresh" action for the "retry" one, which
              // actually re-enqueues transmission instead of just re-polling a channel that never
              // accepted the document in the first place.
              const isTransmissionFailed = compDoc.status === "TRANSMISSION_FAILED"
              return (
                <div className="mt-6 border-t pt-4">
                  <div className="flex items-center justify-between gap-2 mb-3 min-w-0">
                    <span className="text-sm font-medium text-muted-foreground min-w-0">Compliance</span>
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${color}`}
                      >
                        {compDoc.status.replace(/_/g, " ")}
                      </span>
                      {isTransmissionFailed ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs text-red-700 hover:text-red-800"
                          disabled={retryingTransmission}
                          onClick={() => handleRetryTransmission(compDoc.id)}
                          title={t("invoices.view.actions.retryTransmission", "Retry")}
                          data-cy="invoice-retry-transmission"
                        >
                          <RotateCcw
                            className={`h-3 w-3 mr-1 ${retryingTransmission ? "animate-spin" : ""}`}
                          />
                          {t("invoices.view.actions.retryTransmission", "Retry")}
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs"
                          disabled={refreshing}
                          onClick={() => handleRefreshComplianceStatus(compDoc.id)}
                          title={t("invoices.view.actions.refreshStatus", "Refresh status")}
                        >
                          <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
                        </Button>
                      )}
                    </div>
                  </div>
                  {compDoc.events && compDoc.events.length > 0 && (
                    <ol className="relative border-l border-muted ml-2 space-y-3">
                      {compDoc.events.map((ev, i) => (
                        <li key={i} className="ml-4">
                          <span className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full border-2 border-background bg-muted-foreground/40" />
                          <p className="text-xs font-medium text-foreground">{ev.type.replace(/_/g, " ")}</p>
                          <p className="text-xs text-muted-foreground break-words">
                            {new Date(ev.at).toLocaleString()}
                            {ev.actor && ev.actor !== "system" && ` · ${ev.actor}`}
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
                <p className="text-sm text-muted-foreground mb-1">
                  {t("invoices.view.fields.correctsInvoice")}
                </p>
                {originalInvoice ? (
                  <p className="font-medium text-sm">
                    {originalInvoice.rawNumber ||
                      originalInvoice.number?.toString() ||
                      originalInvoice.id.slice(0, 8)}
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
                    <div key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge variant="secondary" className={`text-xs ${getInvoiceKindColor(c.kind)}`}>
                        {getInvoiceKindLabel(c.kind)}
                      </Badge>
                      <span className="font-medium min-w-0 break-words">
                        {c.rawNumber || c.number?.toString()}
                      </span>
                      <span className="text-muted-foreground">
                        {c.totalTTC.toFixed(2)} {c.currency}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Compliance panels — every line of them comes from the country profile, via the
                available-actions payload. No country is named in the frontend. */}
            {actions && invoice.status !== "DRAFT" && (
              <div className="space-y-2" data-cy="compliance-panels">
                <CancellationPolicyPanel actions={actions} />
                <ObligationLayersPanel actions={actions} />
                <ArchivalPanel actions={actions} />
              </div>
            )}

            {/* Linked deposit invoices (for FINAL kind or parent with deposits) */}
            {invoice.depositInvoices && invoice.depositInvoices.length > 0 && (
              <div className="bg-muted/50 p-4 rounded-lg" data-cy="linked-deposits">
                <p className="text-sm text-muted-foreground mb-2">
                  {t("invoices.view.fields.linkedDeposits")}
                </p>
                <div className="flex flex-col gap-1">
                  {invoice.depositInvoices.map((dep) => (
                    <div key={dep.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge variant="secondary" className={`text-xs ${getInvoiceKindColor(dep.kind)}`}>
                        {getInvoiceKindLabel(dep.kind)}
                      </Badge>
                      <span className="font-medium min-w-0 break-words">
                        {dep.rawNumber || dep.number?.toString()}
                      </span>
                      <span className="text-muted-foreground">
                        {dep.totalTTC.toFixed(2)} {dep.currency}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 pt-2 border-t flex justify-end text-sm font-medium">
                  {t("invoices.view.fields.totalDeposited")}:{" "}
                  {invoice.depositInvoices.reduce((sum, dep) => sum + dep.totalTTC, 0).toFixed(2)}{" "}
                  {invoice.currency}
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
