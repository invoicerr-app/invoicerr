import { useTranslation } from "react-i18next"

import { useDocumentSettlement } from "@/hooks/queries"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

import type { DocumentSettlement } from "./types"
import { decimalsFor, fromMinor } from "./totals-calculator"

/**
 * The SOLDE — a PROJECTION derived from `computeSettlement` (backend) at read time, never a document
 * STATUS: an invoice fully paid stays "sent" in its declared lifecycle (descriptors/lifecycle.ts) —
 * see the backend's invoice.descriptor.ts for the full reasoning behind that choice. This file is
 * generic (nothing here names "invoice"): both components below are shown for ANY document type
 * whose descriptor declares a "record-payment"-shaped action — see their own callers
 * (document-list.tsx, document-form.tsx), which gate on `descriptor.actions` alone, the same way
 * `descriptor.numbering` already gates the number badge without naming a type either.
 */

type SettlementTone = "neutral" | "warning" | "success" | "info"

interface SettlementBadgeInfo {
  tone: SettlementTone
  labelKey: string
}

/** Pure: which tone/label a balance renders as — extracted so the list badge and the section's own
 *  badge always agree, and so it's testable without mounting anything. */
export function settlementBadgeInfo(settlement: DocumentSettlement): SettlementBadgeInfo {
  if (settlement.settled) {
    return settlement.overpaidMinor > 0
      ? { tone: "info", labelKey: "documents.settlement.badge.overpaid" }
      : { tone: "success", labelKey: "documents.settlement.badge.paid" }
  }
  return settlement.paidMinor > 0
    ? { tone: "warning", labelKey: "documents.settlement.badge.partiallyPaid" }
    : { tone: "neutral", labelKey: "documents.settlement.badge.unpaid" }
}

const TONE_CLASSES: Record<SettlementTone, string> = {
  neutral: "bg-secondary text-secondary-foreground",
  info: "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300",
  success: "bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
}

function formatMinor(minor: number, currency: string): string {
  return `${fromMinor(minor, currency).toFixed(decimalsFor(currency))} ${currency}`
}

interface DocumentSettlementBadgeProps {
  typeId: string
  documentId: string
  className?: string
  /** Distinguishes multiple badges rendered at once (the document list, one per row) — appended to
   *  the base `data-cy` so each row's badge is independently selectable, the same convention
   *  document-list.tsx's own `document-number-${instance.id}` already uses. */
  dataCySuffix?: string
}

/** A small, standalone badge — used both in the document list (one per row) and inside the
 *  settlement section below (so the section's own heading carries the same tone/label the list
 *  already showed, never a second, possibly-drifting computation of the same fact). */
export function DocumentSettlementBadge({
  typeId,
  documentId,
  className,
  dataCySuffix,
}: DocumentSettlementBadgeProps) {
  const { t } = useTranslation()
  const { data } = useDocumentSettlement(typeId, documentId)
  if (!data) return null

  const { tone, labelKey } = settlementBadgeInfo(data.settlement)
  return (
    <Badge
      variant="outline"
      className={cn("border-transparent font-semibold", TONE_CLASSES[tone], className)}
      data-cy={dataCySuffix ? `document-settlement-badge-${dataCySuffix}` : "document-settlement-badge"}
    >
      {t(labelKey)}
    </Badge>
  )
}

interface DocumentSettlementSectionProps {
  typeId: string
  documentId: string
}

/**
 * The "Payments" section inside the edit dialog: the badge, the balance (paid / outstanding /
 * overpaid), and the list of payments recorded so far. Does NOT render the "record-payment" button
 * itself — that is the descriptor's own action, already rendered generically by document-form.tsx's
 * action loop (the mechanism this whole task tests: the declared params are enough for that existing
 * screen, nothing bespoke needed here).
 */
export function DocumentSettlementSection({ typeId, documentId }: DocumentSettlementSectionProps) {
  const { t } = useTranslation()
  const { data, isLoading } = useDocumentSettlement(typeId, documentId)

  if (isLoading) {
    return (
      <div className="space-y-2" data-cy="document-settlement-section">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }
  if (!data) return null

  const currency = data.totals.currency ?? ""
  const { settlement, payments } = data

  return (
    <div className="space-y-3 rounded-lg border p-4" data-cy="document-settlement-section">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{t("documents.settlement.title")}</h4>
        <DocumentSettlementBadge typeId={typeId} documentId={documentId} />
      </div>

      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
        <div data-cy="document-settlement-paid">
          <dt className="text-muted-foreground">{t("documents.settlement.paid")}</dt>
          <dd className="font-medium">{formatMinor(settlement.paidMinor, currency)}</dd>
        </div>
        <div data-cy="document-settlement-outstanding">
          <dt className="text-muted-foreground">{t("documents.settlement.outstanding")}</dt>
          <dd className="font-medium">{formatMinor(settlement.outstandingMinor, currency)}</dd>
        </div>
        {settlement.overpaidMinor > 0 && (
          <div data-cy="document-settlement-overpaid">
            <dt className="text-muted-foreground">{t("documents.settlement.overpaid")}</dt>
            <dd className="font-medium">{formatMinor(settlement.overpaidMinor, currency)}</dd>
          </div>
        )}
      </dl>

      {payments.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-cy="document-settlement-empty">
          {t("documents.settlement.empty")}
        </p>
      ) : (
        <ul className="divide-y" data-cy="document-settlement-payments-list">
          {payments.map((payment) => (
            <li
              key={payment.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              data-cy={`document-settlement-payment-${payment.id}`}
            >
              <span className="text-muted-foreground">{new Date(payment.paidAt).toLocaleDateString()}</span>
              <span className="font-medium">{formatMinor(payment.amountMinor, payment.currency)}</span>
              {payment.method && <span className="text-muted-foreground">{payment.method}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
