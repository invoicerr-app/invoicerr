// TODO_FEATURES.md rank 5 ("rapprochement bancaire par import de relevé"). Mirrors the backend's
// BankReconciliationService response shapes (backend/src/modules/documents/bank-reconciliation/).

export type BankStatementFormat = "CSV" | "OFX"
export type BankStatementLineStatus = "UNMATCHED" | "RECONCILED"
export type CsvDateFormat = "YYYY-MM-DD" | "DD/MM/YYYY" | "MM/DD/YYYY"
export type CsvDecimalSeparator = "." | ","
export type MatchReason = "reference" | "date-window"

export interface CsvColumnMapping {
  dateColumn: string
  amountColumn: string
  labelColumn: string
  referenceColumn?: string
  dateFormat: CsvDateFormat
  decimalSeparator: CsvDecimalSeparator
}

export interface BankStatement {
  id: string
  fileName: string
  format: BankStatementFormat
  currency: string
  importedAt: string
  lineCount: number
}

export interface BankStatementSummary extends BankStatement {
  unmatchedCount: number
  reconciledCount: number
}

export interface BankStatementLine {
  id: string
  statementId: string
  lineIndex: number
  date: string
  /** Signed — a debit (money-out) line is imported and shown too, it is just never reconcilable. */
  amountMinor: number
  label: string
  reference: string | null
  status: BankStatementLineStatus
  reconciledDocumentId: string | null
  reconciledPaymentId: string | null
  reconciledAt: string | null
}

export interface MatchCandidateInvoice {
  documentId: string
  displayNumber: string | null
  clientLabel: string | null
  currency: string
  outstandingMinor: number
  issueDate: string | null
  dueDate: string | null
}

export interface MatchSuggestion {
  documentId: string
  displayNumber: string | null
  clientLabel: string | null
  outstandingMinor: number
  reasons: MatchReason[]
}

export interface StatementLineWithSuggestions {
  line: BankStatementLine
  suggestions: MatchSuggestion[]
  reconciledInvoiceLabel: string | null
}

export interface StatementLinesView {
  statement: BankStatement
  candidates: MatchCandidateInvoice[]
  lines: StatementLineWithSuggestions[]
}

export interface ImportBankStatementResult {
  statement: BankStatement
  /** Rows the parser could not read — the import still succeeds for every other row. */
  errors: string[]
}
