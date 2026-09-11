import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { settlementBadgeInfo, TONE_CLASSES } from "@/components/documents/document-settlement"
import { decimalsFor, fromMinor } from "@/components/documents/totals-calculator"
import { useClientStatement } from "@/hooks/queries"
import { cn } from "@/lib/utils"
import type { Client, ClientStatementCurrencyTotals, ClientStatementDocumentRow } from "@/types"

/**
 * A client's own account statement ("relevé de compte client"), opened
 * from the clients list (index.tsx's own "Statement" action, next to view/edit/delete). Read-only:
 * this screen computes nothing itself — every number here is exactly what `GET /clients/:id/
 * statement` (the backend's `resolveClientStatement`) already resolved, the same "the backend
 * decides, the screen only renders" discipline document-settlement.tsx already holds for a single
 * document's own balance.
 */

interface ClientStatementDialogProps {
  client: Client | null
  onOpenChange: (open: boolean) => void
}

function formatMinor(minor: number, currency: string): string {
  return `${fromMinor(minor, currency).toFixed(decimalsFor(currency))} ${currency}`
}

/** A client billed in ONLY one currency (the overwhelming common case) keeps the bare `data-cy`
 *  names (`client-statement-total`, `client-statement-aged-0-30`, …); a client billed in MORE than
 *  one currency (never silently mixed — see the backend's own `ClientStatementCurrencyTotals`
 *  header) gets one block PER currency, each suffixed so every selector stays independently stable. */
function currencySuffix(currency: string, totals: ClientStatementCurrencyTotals[]): string {
  return totals.length > 1 ? `-${currency.toLowerCase()}` : ""
}

function clientDisplayName(client: Client | null): string {
  if (!client) return ""
  if (client.type === "INDIVIDUAL") {
    return `${client.contactFirstname ?? ""} ${client.contactLastname ?? ""}`.trim()
  }
  return client.name
}

function StatementRowBadge({ row }: { row: ClientStatementDocumentRow }) {
  const { t } = useTranslation()
  // Reuses document-settlement.tsx's OWN tone/label decision — never a second computation of the
  // same fact: a row's `settled`/`paidMinor` are exactly the fields that function reads off a real
  // `DocumentSettlement`, so a synthetic one built from them (creditedMinor always 0 here — this
  // row's own amount already has any credit netted in, see settlement/client-statement.ts's header)
  // yields the identical tone/label a document's own settlement section would show.
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

  return (
    <div className="space-y-3 rounded-lg border p-4">
      {allTotals.length > 1 && (
        <p className="text-xs font-semibold uppercase text-muted-foreground">{totals.currency}</p>
      )}
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-muted-foreground">{t("clients.statement.totalOutstanding")}</span>
        <span className="text-lg font-semibold" data-cy={`client-statement-total${suffix}`}>
          {formatMinor(totals.totalOutstandingMinor, totals.currency)}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div data-cy={`client-statement-aged-current${suffix}`}>
          <dt className="text-muted-foreground">{t("clients.statement.aging.current")}</dt>
          <dd className="font-medium">{formatMinor(totals.currentMinor, totals.currency)}</dd>
        </div>
        <div data-cy={`client-statement-aged-0-30${suffix}`}>
          <dt className="text-muted-foreground">{t("clients.statement.aging.days0to30")}</dt>
          <dd className="font-medium">{formatMinor(totals.days0to30Minor, totals.currency)}</dd>
        </div>
        <div data-cy={`client-statement-aged-31-60${suffix}`}>
          <dt className="text-muted-foreground">{t("clients.statement.aging.days31to60")}</dt>
          <dd className="font-medium">{formatMinor(totals.days31to60Minor, totals.currency)}</dd>
        </div>
        <div data-cy={`client-statement-aged-60-plus${suffix}`}>
          <dt className="text-muted-foreground">{t("clients.statement.aging.days60plus")}</dt>
          <dd className="font-medium">{formatMinor(totals.days60PlusMinor, totals.currency)}</dd>
        </div>
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
        className="flex max-h-[90dvh] w-full max-w-[95vw] flex-col overflow-y-auto p-6 md:max-w-3xl lg:max-w-5xl"
        data-cy="client-statement"
      >
        <DialogHeader>
          <DialogTitle>{t("clients.statement.title", { name: clientDisplayName(client) })}</DialogTitle>
          <DialogDescription>{t("clients.statement.description")}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : !data || data.documents.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-cy="client-statement-empty">
            {t("clients.statement.empty")}
          </p>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-4">
              {data.totals.map((totals) => (
                <CurrencyStatementCard key={totals.currency} totals={totals} allTotals={data.totals} />
              ))}
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("clients.statement.columns.type")}</TableHead>
                    <TableHead>{t("clients.statement.columns.document")}</TableHead>
                    <TableHead>{t("clients.statement.columns.issueDate")}</TableHead>
                    <TableHead>{t("clients.statement.columns.dueDate")}</TableHead>
                    <TableHead>{t("clients.statement.columns.amount")}</TableHead>
                    <TableHead>{t("clients.statement.columns.paid")}</TableHead>
                    <TableHead>{t("clients.statement.columns.outstanding")}</TableHead>
                    <TableHead>{t("clients.statement.columns.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.documents.map((row) => (
                    <TableRow key={row.id} data-cy={`client-statement-row-${row.id}`}>
                      <TableCell>
                        {t(
                          row.typeId === "invoice"
                            ? "clients.statement.type.invoice"
                            : "clients.statement.type.creditNote",
                        )}
                      </TableCell>
                      <TableCell>{row.displayNumber ?? row.id}</TableCell>
                      <TableCell>{row.issueDate ?? "—"}</TableCell>
                      <TableCell>{row.dueDate ?? "—"}</TableCell>
                      <TableCell>{formatMinor(row.amountMinor, row.currency)}</TableCell>
                      <TableCell>{formatMinor(row.paidMinor, row.currency)}</TableCell>
                      <TableCell>{formatMinor(row.outstandingMinor, row.currency)}</TableCell>
                      <TableCell>
                        <StatementRowBadge row={row} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
