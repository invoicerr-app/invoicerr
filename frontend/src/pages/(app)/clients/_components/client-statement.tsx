import { Receipt } from "lucide-react"
import { useTranslation } from "react-i18next"

import { settlementBadgeInfo, TONE_CLASSES } from "@/components/documents/document-settlement"
import { decimalsFor, fromMinor } from "@/components/documents/totals-calculator"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useClientStatement } from "@/hooks/queries"
import { cn } from "@/lib/utils"
import type { Client, ClientStatementCurrencyTotals, ClientStatementDocumentRow } from "@/types"

import { clientDisplayName } from "./client-display"

/**
 * A client's own account statement, opened from the clients list. Read-only: this screen computes
 * nothing itself — every number here is exactly what `GET /clients/:id/statement` (the backend's
 * `resolveClientStatement`) already resolved, the same "the backend decides, the screen only
 * renders" discipline document-settlement.tsx already holds for a single document's own balance.
 */

interface ClientStatementDialogProps {
  client: Client | null
  onOpenChange: (open: boolean) => void
}

export function formatMinor(minor: number, currency: string): string {
  return `${fromMinor(minor, currency).toFixed(decimalsFor(currency))} ${currency}`
}

/** A client billed in ONLY one currency (the overwhelming common case) keeps the bare `data-cy`
 *  names (`client-statement-total`, `client-statement-aged-0-30`, …); a client billed in MORE than
 *  one currency (never silently mixed — see the backend's own `ClientStatementCurrencyTotals`
 *  header) gets one block PER currency, each suffixed so every selector stays independently stable. */
function currencySuffix(currency: string, totals: ClientStatementCurrencyTotals[]): string {
  return totals.length > 1 ? `-${currency.toLowerCase()}` : ""
}

/** Reuses document-settlement.tsx's OWN tone/label decision — never a second computation of the
 *  same fact: a row's `settled`/`paidMinor` are exactly the fields that function reads off a real
 *  `DocumentSettlement`, so a synthetic one built from them (creditedMinor always 0 here — this
 *  row's own amount already has any credit netted in, see settlement/client-statement.ts's header)
 *  yields the identical tone/label a document's own settlement section would show. */
export function StatementRowBadge({ row }: { row: ClientStatementDocumentRow }) {
  const { t } = useTranslation()
  const { tone, labelKey } = settlementBadgeInfo({
    totalGrossMinor: row.amountMinor,
    paidMinor: row.paidMinor,
    creditedMinor: 0,
    outstandingMinor: row.outstandingMinor,
    excessMinor: 0,
    settled: row.settled,
  })
  return (
    <Badge variant="outline" className={cn("border-transparent font-semibold", TONE_CLASSES[tone])}>
      {t(labelKey)}
    </Badge>
  )
}

function CurrencyStatementCard({
  totals,
  allTotals,
}: {
  totals: ClientStatementCurrencyTotals
  allTotals: ClientStatementCurrencyTotals[]
}) {
  const { t } = useTranslation()
  const suffix = currencySuffix(totals.currency, allTotals)
  const aging: [string, string, number][] = [
    [`client-statement-aged-current${suffix}`, t("clients.statement.aging.current"), totals.currentMinor],
    [`client-statement-aged-0-30${suffix}`, t("clients.statement.aging.days0to30"), totals.days0to30Minor],
    [`client-statement-aged-31-60${suffix}`, t("clients.statement.aging.days31to60"), totals.days31to60Minor],
    [
      `client-statement-aged-60-plus${suffix}`,
      t("clients.statement.aging.days60plus"),
      totals.days60PlusMinor,
    ],
  ]

  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("clients.statement.totalOutstanding")}
          {allTotals.length > 1 && ` · ${totals.currency}`}
        </span>
        <span className="amount text-lg font-semibold" data-cy={`client-statement-total${suffix}`}>
          {formatMinor(totals.totalOutstandingMinor, totals.currency)}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {aging.map(([dataCy, label, minor]) => (
          <div key={dataCy} data-cy={dataCy}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="amount mt-0.5 font-medium">{formatMinor(minor, totals.currency)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function ClientStatementDialog({ client, onOpenChange }: ClientStatementDialogProps) {
  const { t } = useTranslation()
  const { data, isLoading } = useClientStatement(client?.id)

  return (
    <Dialog open={client != null} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[90vh] w-full flex-col gap-0 p-0 sm:max-w-3xl lg:max-w-5xl"
        data-cy="client-statement"
      >
        <DialogHeader className="border-b px-6 py-4 pr-12">
          <DialogTitle>{t("clients.statement.title", { name: clientDisplayName(client) })}</DialogTitle>
          <DialogDescription>{t("clients.statement.description")}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : !data || data.documents.length === 0 ? (
            <EmptyState
              icon={Receipt}
              size="sm"
              title={t("clients.statement.empty")}
              data-cy="client-statement-empty"
            />
          ) : (
            <div className="space-y-6">
              <div className="grid gap-4">
                {data.totals.map((totals) => (
                  <CurrencyStatementCard key={totals.currency} totals={totals} allTotals={data.totals} />
                ))}
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("clients.statement.columns.type")}</TableHead>
                    <TableHead>{t("clients.statement.columns.document")}</TableHead>
                    <TableHead>{t("clients.statement.columns.issueDate")}</TableHead>
                    <TableHead>{t("clients.statement.columns.dueDate")}</TableHead>
                    <TableHead className="text-right">{t("clients.statement.columns.amount")}</TableHead>
                    <TableHead className="text-right">{t("clients.statement.columns.paid")}</TableHead>
                    <TableHead className="text-right">{t("clients.statement.columns.outstanding")}</TableHead>
                    <TableHead>{t("clients.statement.columns.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.documents.map((row) => (
                    <TableRow key={row.id} data-cy={`client-statement-row-${row.id}`}>
                      <TableCell className="text-muted-foreground">
                        {t(
                          row.typeId === "invoice"
                            ? "clients.statement.type.invoice"
                            : "clients.statement.type.creditNote",
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.displayNumber ?? row.id.slice(0, 8)}
                      </TableCell>
                      <TableCell className="tabular-nums">{row.issueDate ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">{row.dueDate ?? "—"}</TableCell>
                      <TableCell className="amount text-right">
                        {formatMinor(row.amountMinor, row.currency)}
                      </TableCell>
                      <TableCell className="amount text-right">
                        {formatMinor(row.paidMinor, row.currency)}
                      </TableCell>
                      <TableCell className="amount text-right font-medium">
                        {formatMinor(row.outstandingMinor, row.currency)}
                      </TableCell>
                      <TableCell>
                        <StatementRowBadge row={row} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
