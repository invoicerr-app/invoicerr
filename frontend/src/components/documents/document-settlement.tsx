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
 *
 * Item 8 of the root TODO ("le lettrage") added CREDITS to the balance — a credit note is NOT a
 * payment (see the backend's compute-settlement.ts header), so the section below renders them as a
 * THIRD block of their own, never merged into the "Payments" list: `paidMinor` and `creditedMinor`
 * stay two separate numbers, and the payments/credits LISTS stay two separate lists, all the way from
 * `computeSettlement` to this screen.
 */

type SettlementTone = "neutral" | "warning" | "success"

interface SettlementBadgeInfo {
  tone: SettlementTone
  labelKey: string
}

/**
 * Pure: which tone/label a balance renders as — extracted so the list badge and the section's own
 * badge always agree, and so it's testable without mounting anything.
 *
 * ONE terminal state, "Settled", regardless of how the balance got to zero (paid, credited, or a mix
 * of both) — NOT a "Paid"/"Overpaid"/"Credited" trio: a fully credited invoice showing "Paid" would
 * be FALSE (nothing was paid), and a fourth "Credited" state was deliberately rejected too many
 * states make a badge harder to read at a glance, not easier. The section's own three blocks below
 * (paid / credited / outstanding) are where a reader sees HOW it got there; the badge only ever
 * answers "does this still owe anything". Renamed from the earlier "Paid" label for the exact same
 * reason — same terminal condition (`settled`), a more honest name for it.
 */
export function settlementBadgeInfo(settlement: DocumentSettlement): SettlementBadgeInfo {
  if (settlement.settled) {
    return { tone: "success", labelKey: "documents.settlement.badge.settled" }
  }
  return settlement.paidMinor > 0 || settlement.creditedMinor > 0
    ? { tone: "warning", labelKey: "documents.settlement.badge.partiallyPaid" }
    : { tone: "neutral", labelKey: "documents.settlement.badge.unpaid" }
}

const TONE_CLASSES: Record<SettlementTone, string> = {
  neutral: "bg-secondary text-secondary-foreground",
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
 * The settlement section inside the edit dialog — THREE blocks, never mixed:
 *  1. the badge + the balance itself (paid / credited / outstanding / excess);
 *  2. the PAYMENTS recorded so far;
 *  3. the CREDIT NOTES correcting this document (item 8, "le lettrage").
 * Does NOT render the "record-payment" button itself — that is the descriptor's own action, already
 * rendered generically by document-form.tsx's action loop (the mechanism this whole task tests: the
 * declared params are enough for that existing screen, nothing bespoke needed here). It does not
 * render a "send" button for a credit note either, for the identical reason.
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
  const { settlement, payments, credits, warnings } = data

  return (
    <div className="space-y-4 rounded-lg border p-4" data-cy="document-settlement-section">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{t("documents.settlement.title")}</h4>
        <DocumentSettlementBadge typeId={typeId} documentId={documentId} />
      </div>

      {/* Block 1: the balance itself. */}
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
        <div data-cy="document-settlement-paid">
          <dt className="text-muted-foreground">{t("documents.settlement.paid")}</dt>
          <dd className="font-medium">{formatMinor(settlement.paidMinor, currency)}</dd>
        </div>
        {settlement.creditedMinor > 0 && (
          <div data-cy="document-settlement-credited">
            <dt className="text-muted-foreground">{t("documents.settlement.credited")}</dt>
            <dd className="font-medium">{formatMinor(settlement.creditedMinor, currency)}</dd>
          </div>
        )}
        <div data-cy="document-settlement-outstanding">
          <dt className="text-muted-foreground">{t("documents.settlement.outstanding")}</dt>
          <dd className="font-medium">{formatMinor(settlement.outstandingMinor, currency)}</dd>
        </div>
        {settlement.excessMinor > 0 && (
          <div data-cy="document-settlement-excess">
            <dt className="text-muted-foreground">{t("documents.settlement.excess")}</dt>
            <dd className="font-medium">{formatMinor(settlement.excessMinor, currency)}</dd>
          </div>
        )}
      </dl>

      {/* Block 2: payments — never mixed with credits below. */}
      <div className="space-y-2">
        <h5 className="text-xs font-semibold uppercase text-muted-foreground">
          {t("documents.settlement.paymentsTitle")}
        </h5>
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
                <span className="flex flex-col items-end">
                  <span className="font-medium">{formatMinor(payment.amountMinor, payment.currency)}</span>
                  {/* TODO_PRODUIT.md T3 — "jamais silencieux": a payment recorded in a currency other
                      than the document's own is CONVERTED (never refused any more), and the pinned,
                      dated rate that conversion used is shown here, verbatim — the same "never a
                      converted amount without its proof" discipline the dashboard's own consolidated
                      widgets already hold (contributions/currency-consolidation.ts). Absent whenever
                      `conversionRate` is null — a same-currency payment was never converted, nothing
                      to disclose. */}
                  {payment.conversionRate != null && (
                    <span
                      className="text-xs text-muted-foreground"
                      data-cy={`document-settlement-payment-${payment.id}-conversion`}
                    >
                      {t("documents.settlement.convertedNote", {
                        converted: formatMinor(payment.documentAmountMinor, currency),
                        from: payment.currency,
                        to: currency,
                        rate: payment.conversionRate,
                        date: payment.conversionRateAsOf
                          ? new Date(payment.conversionRateAsOf).toISOString().slice(0, 10)
                          : "",
                      })}
                    </span>
                  )}
                </span>
                {payment.method && <span className="text-muted-foreground">{payment.method}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Block 3: credit notes — a DIFFERENT list, a DIFFERENT kind of fact (a withdrawal from the
          claim, not cash received — see compute-settlement.ts's own header). Only rendered at all
          once this document type actually HAS a notion of credits (documents.service.ts's
          `resolveCreditsForDocument` returns `credits: []` for every type but "invoice" today) —
          hiding the whole block rather than showing a permanently-empty one for a type that can never
          have credits, the same "no dashboard for a type that would show empty nearly always" choice
          credit-note-contributions.ts already makes for ITS OWN dashboard presence. */}
      {credits.length > 0 || warnings.length > 0 ? (
        <div className="space-y-2">
          <h5 className="text-xs font-semibold uppercase text-muted-foreground">
            {t("documents.settlement.creditsTitle")}
          </h5>
          {credits.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-cy="document-settlement-credits-empty">
              {t("documents.settlement.creditsEmpty")}
            </p>
          ) : (
            <ul className="divide-y" data-cy="document-settlement-credits-list">
              {credits.map((credit) => (
                <li
                  key={credit.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                  data-cy={`document-settlement-credit-${credit.id}`}
                >
                  {/* The credit note's own displayNumber IS the visual link back to it — the same
                      identifier the credit-note list itself would show for this same record. Falls
                      back to the raw id (never blank) for one issued before this type declares
                      `numbering` — the same fallback credit-note-contributions.ts's own
                      `resolveInvoiceLabel` already uses for the identical "no number yet" case. */}
                  <span className="font-medium">{credit.displayNumber ?? credit.id}</span>
                  <span className="font-medium">{formatMinor(credit.amountMinor, credit.currency)}</span>
                </li>
              ))}
            </ul>
          )}
          {warnings.length > 0 && (
            <div className="space-y-1 rounded bg-yellow-50 p-2" data-cy="document-settlement-warnings">
              {warnings.map((warning) => (
                <p key={warning} className="text-xs text-yellow-800">
                  {warning}
                </p>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
