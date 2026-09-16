import { ListX } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { currencies } from "@/lib/constants/currencies"
import { cn } from "@/lib/utils"
import { ApiError } from "@/hooks/use-api-query"
import { useBankStatementLines, useReconcileBankStatementLine } from "@/hooks/queries"

interface StatementLinesProps {
  statementId: string
}

/**
 * One statement's own lines — each UNMATCHED, credit (money-in) line offers its live suggestions as
 * one-click buttons PLUS a manual picker over every outstanding invoice in the statement's own
 * currency (`candidates`), so a line the matcher missed can still be reconciled by hand. Confirming
 * either path is the SAME `POST .../lines/:id/reconcile` call — see that hook's own header.
 *
 * A RECONCILED line renders ONLY a badge naming its invoice, with no reconcile control left at all —
 * this IS the screen's own half of "the same line cannot be reconciled twice": the control simply no
 * longer exists once a line is reconciled (the backend's own 409 is the other, authoritative half —
 * see bank-reconciliation.service.ts's own header).
 */
export function StatementLines({ statementId }: StatementLinesProps) {
  const { t } = useTranslation()
  const { data, isLoading } = useBankStatementLines(statementId)
  const reconcile = useReconcileBankStatementLine(statementId)
  const [pickedInvoiceByLine, setPickedInvoiceByLine] = useState<Record<string, string>>({})

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    )
  }

  const { statement, candidates, lines } = data
  const decimals = currencies[statement.currency]?.decimals ?? 2
  const formatAmount = (minor: number) => (minor / 10 ** decimals).toFixed(decimals)

  const handleReconcile = async (lineId: string, documentId: string | undefined) => {
    if (!documentId) return
    try {
      await reconcile.mutateAsync({ lineId, documentId })
      toast.success(t("bankReconciliation.lines.reconcileSuccess"))
    } catch (error) {
      toast.error(
        error instanceof ApiError && error.status === 409
          ? t("bankReconciliation.lines.alreadyReconciled")
          : error instanceof ApiError
            ? error.message
            : t("bankReconciliation.lines.reconcileError"),
      )
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{statement.fileName}</CardTitle>
      </CardHeader>
      <CardContent>
        {lines.length === 0 ? (
          <EmptyState
            icon={ListX}
            size="sm"
            title={t("bankReconciliation.lines.empty")}
            data-cy="bank-reconciliation-lines-empty"
          />
        ) : (
          <Table data-cy="bank-reconciliation-lines-table">
            <TableHeader>
              <TableRow>
                <TableHead>{t("bankReconciliation.lines.date")}</TableHead>
                <TableHead>{t("bankReconciliation.lines.label")}</TableHead>
                <TableHead className="text-right tabular-nums">
                  {t("bankReconciliation.lines.amount")}
                </TableHead>
                <TableHead>{t("bankReconciliation.lines.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map(({ line, suggestions, reconciledInvoiceLabel }) => (
                <TableRow key={line.id} data-cy={`bank-reconciliation-line-${line.id}`}>
                  <TableCell className="tabular-nums">{new Date(line.date).toLocaleDateString()}</TableCell>
                  <TableCell className="max-w-xs truncate" title={line.label}>
                    {line.label}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono tabular-nums whitespace-nowrap",
                      line.amountMinor < 0 && "text-destructive",
                    )}
                  >
                    {formatAmount(line.amountMinor)} {statement.currency}
                  </TableCell>
                  <TableCell className="min-w-64">
                    {line.status === "RECONCILED" ? (
                      <Badge data-cy="bank-reconciliation-line-status-reconciled">
                        {t("bankReconciliation.lines.reconciledWith", {
                          invoice: reconciledInvoiceLabel ?? line.reconciledDocumentId,
                        })}
                      </Badge>
                    ) : line.amountMinor <= 0 ? (
                      <span className="text-xs text-muted-foreground">
                        {t("bankReconciliation.lines.debit")}
                      </span>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {suggestions.length > 0 && (
                          <div
                            className="flex flex-wrap gap-1.5"
                            data-cy={`bank-reconciliation-line-suggestions-${line.id}`}
                          >
                            {suggestions.map((suggestion) => (
                              <Button
                                key={suggestion.documentId}
                                type="button"
                                size="sm"
                                variant="outline"
                                loading={reconcile.isPending}
                                onClick={() => handleReconcile(line.id, suggestion.documentId)}
                                dataCy={`bank-reconciliation-line-suggestion-${line.id}-${suggestion.documentId}`}
                              >
                                {suggestion.displayNumber ?? suggestion.documentId}
                                {suggestion.reasons.includes("reference") && (
                                  <Badge variant="secondary">
                                    {t("bankReconciliation.lines.reasonReference")}
                                  </Badge>
                                )}
                              </Button>
                            ))}
                          </div>
                        )}

                        <div className="flex items-center gap-2">
                          <Select
                            value={pickedInvoiceByLine[line.id] ?? ""}
                            onValueChange={(value) =>
                              setPickedInvoiceByLine((previous) => ({ ...previous, [line.id]: value }))
                            }
                          >
                            <SelectTrigger
                              className="w-56"
                              dataCy={`bank-reconciliation-line-picker-${line.id}`}
                            >
                              <SelectValue placeholder={t("bankReconciliation.lines.pickInvoice")} />
                            </SelectTrigger>
                            <SelectContent>
                              {candidates.map((candidate) => (
                                <SelectItem key={candidate.documentId} value={candidate.documentId}>
                                  {candidate.displayNumber ?? candidate.documentId}
                                  {candidate.clientLabel ? ` — ${candidate.clientLabel}` : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            type="button"
                            size="sm"
                            disabled={!pickedInvoiceByLine[line.id]}
                            loading={reconcile.isPending}
                            onClick={() => handleReconcile(line.id, pickedInvoiceByLine[line.id])}
                            dataCy={`bank-reconciliation-line-reconcile-${line.id}`}
                          >
                            {t("bankReconciliation.lines.reconcile")}
                          </Button>
                        </div>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
