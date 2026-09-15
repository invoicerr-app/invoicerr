import { useState } from "react"
import { useTranslation } from "react-i18next"

import { usePageHeader } from "@/hooks/use-page-header"
import { useBankStatements } from "@/hooks/queries"

import { StatementList } from "./_components/statement-list"
import { StatementLines } from "./_components/statement-lines"

/**
 * Bank reconciliation by statement import — "jugée la plus importante
 * par les utilisateurs dans les comparatifs". Two panels, the same generic shape
 * time-tracking/index.tsx already holds for its own Project/TimeEntry pair: the top one lists imported
 * statements (and is where a new one gets imported), the bottom one shows the SELECTED statement's own
 * lines, each with its live suggested matches — see StatementLines' own header for why confirming one
 * is the ONLY write this whole feature ever performs.
 */
export default function BankReconciliationPage() {
  const { t } = useTranslation()
  usePageHeader(t("bankReconciliation.title"))

  const { data: statements = [], isLoading } = useBankStatements()
  const [selectedStatementId, setSelectedStatementId] = useState<string | null>(null)

  return (
    <div className="max-w-6xl mx-auto space-y-6 p-6" data-cy="bank-reconciliation-page">
      <StatementList
        statements={statements}
        loading={isLoading}
        selectedStatementId={selectedStatementId}
        onSelect={setSelectedStatementId}
      />

      {selectedStatementId && <StatementLines statementId={selectedStatementId} />}
    </div>
  )
}
