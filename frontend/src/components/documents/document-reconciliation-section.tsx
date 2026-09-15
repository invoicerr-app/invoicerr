import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { TONE_CLASSES, type SettlementTone } from "@/components/documents/document-settlement"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import {
  type LineMatchVerdict,
  useAcceptVariance,
  useCompanies,
  useReceivedInvoiceReconciliation,
} from "@/hooks/queries"
import { ApiError } from "@/hooks/use-api-query"
import { cn } from "@/lib/utils"

/**
 * TODO_FEATURES.md rank 19, second pass ("rapprochement à 3 voies") — the "Reconciliation" panel on
 * a received invoice's own edit dialog: purchase order × goods receipt(s) × this invoice, per line,
 * with the company's own tolerance already applied (backend's `reconciliation/three-way-match.ts`).
 *
 * TYPE-SPECIFIC on purpose, unlike `DocumentArchiveSection`/`DocumentConformitySection` (both
 * type-BLIND, self-hiding components document-form.tsx renders for every type): the backend route
 * this reads (`GET /documents/received-invoices/:id/reconciliation`) exists ONLY for
 * "received-invoice" — see that controller's own header. `document-form.tsx` gates its own render on
 * `descriptor.id === "received-invoice"` for exactly this reason; THIS component additionally
 * self-hides for the routine case where the CURRENT received invoice has no purchase order linked at
 * all (`hasPurchaseOrder: false` — never an error, see the backend composition's own header).
 *
 * "Accept the variance" is shown ONLY for OWNER/ADMIN (`useCompanies().activeRole`) — a pure UX
 * convenience: the real gate is server-side (`@Roles` on the backend route), so a MEMBER who somehow
 * still triggered the request would be refused there too, never merely hidden-but-reachable.
 */
interface DocumentReconciliationSectionProps {
  documentId: string
}

const VERDICT_BADGE: Record<LineMatchVerdict, { tone: SettlementTone; labelKey: string }> = {
  "within-tolerance": { tone: "success", labelKey: "documents.reconciliation.verdict.withinTolerance" },
  "to-review": { tone: "warning", labelKey: "documents.reconciliation.verdict.toReview" },
  accepted: { tone: "neutral", labelKey: "documents.reconciliation.verdict.accepted" },
}

function VerdictBadge({ verdict, dataCy }: { verdict: LineMatchVerdict; dataCy: string }) {
  const { t } = useTranslation()
  const { tone, labelKey } = VERDICT_BADGE[verdict]
  return (
    <Badge
      variant="outline"
      className={cn("border-transparent font-semibold", TONE_CLASSES[tone])}
      data-cy={dataCy}
    >
      {t(labelKey)}
    </Badge>
  )
}

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function formatPercent(value: number | null): string {
  if (value === null) return "—"
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`
}

export function DocumentReconciliationSection({ documentId }: DocumentReconciliationSectionProps) {
  const { t } = useTranslation()
  const { activeRole } = useCompanies()
  const { data, isLoading } = useReceivedInvoiceReconciliation(documentId)
  const acceptVariance = useAcceptVariance()
  const [reason, setReason] = useState("")

  const canAccept = activeRole === "OWNER" || activeRole === "ADMIN"

  const handleAccept = async () => {
    try {
      await acceptVariance.mutateAsync({ documentId, reason: reason.trim() || undefined })
      setReason("")
      toast.success(t("documents.reconciliation.acceptSuccess"))
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("documents.reconciliation.acceptError"))
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-2" data-cy="document-reconciliation-section">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  // Self-hides — see this file's own header: no purchase order linked is the routine case, not an
  // error, for a received invoice that never has a PO to reconcile against.
  if (!data?.hasPurchaseOrder) return null

  const { overallVerdict, tolerancePercent, lines, acceptance } = data

  return (
    <div className="space-y-4 rounded-lg border p-4" data-cy="document-reconciliation-section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{t("documents.reconciliation.title")}</h4>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t("documents.reconciliation.tolerance", { percent: tolerancePercent })}
          </span>
          <VerdictBadge verdict={overallVerdict} dataCy="document-reconciliation-overall-badge" />
        </div>
      </div>

      <div className="overflow-x-auto">
        <Table data-cy="document-reconciliation-table">
          <TableHeader>
            <TableRow>
              <TableHead>{t("documents.reconciliation.columns.description")}</TableHead>
              <TableHead className="text-right">{t("documents.reconciliation.columns.ordered")}</TableHead>
              <TableHead className="text-right">{t("documents.reconciliation.columns.received")}</TableHead>
              <TableHead className="text-right">{t("documents.reconciliation.columns.invoiced")}</TableHead>
              <TableHead className="text-right">
                {t("documents.reconciliation.columns.priceOrdered")}
              </TableHead>
              <TableHead className="text-right">
                {t("documents.reconciliation.columns.priceInvoiced")}
              </TableHead>
              <TableHead className="text-right">
                {t("documents.reconciliation.columns.totalVariance")}
              </TableHead>
              <TableHead>{t("documents.reconciliation.columns.verdict")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line, index) => (
              <TableRow
                // A LINE's OWN normalized description is already the engine's own matching key
                // (three-way-match.ts) — one entry per distinct description, never duplicated.
                key={line.description}
                data-cy={`document-reconciliation-line-${index}`}
                className={line.verdict === "to-review" ? "bg-amber-50 dark:bg-amber-950/20" : undefined}
              >
                <TableCell className="font-medium">{line.description}</TableCell>
                <TableCell className="text-right">{formatNumber(line.quantityOrdered)}</TableCell>
                <TableCell className="text-right">{formatNumber(line.quantityReceived)}</TableCell>
                <TableCell className="text-right">{formatNumber(line.quantityInvoiced)}</TableCell>
                <TableCell className="text-right">
                  {line.unitPriceOrdered === null ? "—" : formatNumber(line.unitPriceOrdered)}
                </TableCell>
                <TableCell className="text-right">
                  {line.unitPriceInvoiced === null ? "—" : formatNumber(line.unitPriceInvoiced)}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right",
                    line.totalVarianceValue > 0 && "text-amber-700 dark:text-amber-400",
                    line.totalVarianceValue < 0 && "text-blue-700 dark:text-blue-400",
                  )}
                  data-cy={`document-reconciliation-line-${index}-variance`}
                >
                  {formatNumber(line.totalVarianceValue)} ({formatPercent(line.totalVariancePercent)})
                </TableCell>
                <TableCell>
                  <VerdictBadge
                    verdict={line.verdict}
                    dataCy={`document-reconciliation-line-${index}-badge`}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {acceptance && (
        <p className="text-xs text-muted-foreground" data-cy="document-reconciliation-acceptance">
          {t("documents.reconciliation.acceptedBy", {
            name: acceptance.acceptedByLabel,
            date: new Date(acceptance.acceptedAt).toLocaleString(),
          })}
          {acceptance.reason ? ` — ${acceptance.reason}` : ""}
        </p>
      )}

      {overallVerdict === "to-review" && canAccept && (
        <div className="space-y-2 border-t pt-3">
          <Textarea
            placeholder={t("documents.reconciliation.reasonPlaceholder")}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="text-sm"
            data-cy="document-reconciliation-accept-reason"
          />
          <Button
            type="button"
            variant="outline"
            loading={acceptVariance.isPending}
            onClick={handleAccept}
            dataCy="document-reconciliation-accept-button"
          >
            {t("documents.reconciliation.acceptButton")}
          </Button>
        </div>
      )}
    </div>
  )
}
