import { useApiMutation, useApiQuery } from "@/hooks/use-api-query"
import { queryKeys } from "@/lib/query-keys"
import type {
  BankStatementSummary,
  CsvColumnMapping,
  ImportBankStatementResult,
  StatementLinesView,
} from "@/types/bank-reconciliation"

/**
 * TODO_FEATURES.md rank 5 ("rapprochement bancaire par import de relevé"). Kept in its own file,
 * mirroring `use-time-tracking.ts`'s own placement — a genuinely separate concern from the generic
 * document machinery (a bank statement is not a `DocumentInstance` at all).
 */

export interface ImportBankStatementVariables {
  fileName: string
  /** Base64-encoded raw file bytes — same wire convention every other upload in this app already
   *  uses (see `use-received-invoices.ts`'s own `UploadReceivedInvoiceVariables`). */
  base64: string
  currency: string
  /** Required for a CSV file, omitted for OFX/QFX (self-describing — see the backend's own
   *  `parse-ofx.ts` header). */
  mapping?: CsvColumnMapping
}

/** `POST /api/bank-reconciliation/statements` — invalidates the statement list so the newly imported
 *  one appears without a manual refetch. Never invalidates any statement's own LINES query: nothing
 *  about importing a NEW statement changes an EXISTING one's lines. */
export function useImportBankStatement() {
  return useApiMutation<ImportBankStatementVariables, ImportBankStatementResult>(
    "POST",
    "/api/bank-reconciliation/statements",
    { invalidateKeys: [queryKeys.bankStatements.list()] },
  )
}

export function useBankStatements() {
  return useApiQuery<BankStatementSummary[]>(
    queryKeys.bankStatements.list(),
    "/api/bank-reconciliation/statements",
  )
}

/** A statement's own lines, each already carrying its live suggested matches — recomputed by the
 *  backend on every fetch (see that endpoint's own header), never cached stale across a reconcile. */
export function useBankStatementLines(statementId: string | null) {
  return useApiQuery<StatementLinesView>(
    queryKeys.bankStatements.lines(statementId ?? ""),
    `/api/bank-reconciliation/statements/${statementId}/lines`,
    { enabled: statementId !== null },
  )
}

export interface ReconcileBankStatementLineVariables {
  lineId: string
  documentId: string
}

/**
 * `POST /api/bank-reconciliation/lines/:id/reconcile` — invalidates BOTH the statement's own lines
 * (this line's status/badge just changed) AND the statement LIST (its unmatched/reconciled counts,
 * shown on the list screen, just changed too). Never invalidates `["documents", ...]` directly: the
 * generic document screens already refetch on their own schedule, and this mutation's own success
 * already tells the caller which invoice just gained a payment if it needs to react further.
 */
export function useReconcileBankStatementLine(statementId: string) {
  return useApiMutation<ReconcileBankStatementLineVariables, { id: string; status: string }>(
    "POST",
    (vars) => `/api/bank-reconciliation/lines/${vars.lineId}/reconcile`,
    {
      invalidateKeys: [queryKeys.bankStatements.lines(statementId), queryKeys.bankStatements.list()],
    },
  )
}
