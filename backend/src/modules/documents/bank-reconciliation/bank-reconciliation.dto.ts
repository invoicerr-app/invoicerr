import { CsvColumnMapping } from './csv-mapping';

/** Same wire convention every other binary/text upload in this backend already uses (no multipart/
 *  `FileInterceptor` anywhere — see `received-invoices.controller.ts`'s own `UploadReceivedInvoiceInput`
 *  header): base64-encoded raw file bytes, decoded server-side. */
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
