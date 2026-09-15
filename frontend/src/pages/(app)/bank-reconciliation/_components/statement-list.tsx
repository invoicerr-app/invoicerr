import { useTranslation } from "react-i18next"
import { FileStack } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { cn } from "@/lib/utils"
import type { BankStatementSummary } from "@/types/bank-reconciliation"

import { ImportStatementDialog } from "./import-statement-dialog"

interface StatementListProps {
  statements: BankStatementSummary[]
  loading: boolean
  selectedStatementId: string | null
  onSelect: (statementId: string) => void
}

export function StatementList({ statements, loading, selectedStatementId, onSelect }: StatementListProps) {
  const { t } = useTranslation()

  return (
    <Card className="gap-0">
      <CardHeader className="border-b flex flex-row items-center justify-between">
        <CardTitle>{t("bankReconciliation.title")}</CardTitle>
        <ImportStatementDialog onImported={onSelect} />
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
          </div>
        ) : statements.length === 0 ? (
          // No CTA here: importing is the header's own dialog trigger, right above this block.
          <EmptyState
            icon={FileStack}
            title={t("bankReconciliation.statements.empty")}
            data-cy="bank-reconciliation-statements-empty"
          />
        ) : (
          <div className="divide-y" data-cy="bank-reconciliation-statement-list">
            {statements.map((statement) => (
              <button
                key={statement.id}
                type="button"
                onClick={() => onSelect(statement.id)}
                className={cn(
                  "w-full text-left p-4 flex items-center justify-between gap-4 hover:bg-muted/50",
                  selectedStatementId === statement.id && "bg-muted",
                )}
                data-cy={`bank-reconciliation-statement-item-${statement.id}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground break-words">{statement.fileName}</span>
                    <Badge variant="outline" className="text-xs">
                      {statement.format}
                    </Badge>
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {statement.currency} · {new Date(statement.importedAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {statement.unmatchedCount > 0 && (
                    <Badge variant="outline" data-cy="bank-reconciliation-statement-unmatched-count">
                      {t("bankReconciliation.statements.unmatched", { count: statement.unmatchedCount })}
                    </Badge>
                  )}
                  {statement.reconciledCount > 0 && (
                    <Badge data-cy="bank-reconciliation-statement-reconciled-count">
                      {t("bankReconciliation.statements.reconciled", { count: statement.reconciledCount })}
                    </Badge>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
