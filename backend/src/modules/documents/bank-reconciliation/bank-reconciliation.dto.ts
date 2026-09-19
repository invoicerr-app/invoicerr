import { CsvColumnMapping } from './csv-mapping';

/** Still base64-in-JSON — unlike `attachments/`, `received-invoices/` and `company/branding/logo`
 *  (all multipart since the 2026-09-17 decision), this route has not been moved: base64-encoded raw
 *  file bytes, decoded server-side. */
export interface ImportBankStatementDto {
  fileName: string;
  base64: string;
  /** The statement's own single declared currency — see `BankStatement.currency`'s own schema
   *  comment on why this is one human-entered fact per statement, never sniffed from the file. */
  currency: string;
  /** Required for a CSV file, ignored for OFX (a self-describing format — see `parse-ofx.ts`'s own
   *  header) — validated by `BankReconciliationService#importStatement`. */
  mapping?: CsvColumnMapping;
}

export interface ReconcileBankStatementLineDto {
  documentId: string;
}
