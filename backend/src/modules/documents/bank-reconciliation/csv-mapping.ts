/**
 * The column mapping a human supplies at IMPORT TIME for a CSV bank statement — see `parse-csv.ts`'s
 * own header for why this feature asks for a mapping instead of guessing one from the header row, or
 * making the user save a named per-bank profile. One mapping serves exactly ONE import; nothing here
 * is persisted (see `bank-reconciliation.service.ts` — only the PARSED lines that result are saved).
 */
export type CsvDateFormat = 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY';
export type CsvDecimalSeparator = '.' | ',';

export interface CsvColumnMapping {
  /** Header names, matched against the file's own first row — case-sensitive, exact: the frontend
   *  reads the SAME header row to populate the mapping form's dropdowns, so whatever a human picks
   *  from it is guaranteed to match verbatim here. */
  dateColumn: string;
  amountColumn: string;
  labelColumn: string;
  /** A bank that exports a separate structured reference column (a transfer/check number) — kept
   *  apart from `labelColumn` because a structured reference is a STRONGER match signal than a
   *  substring search over free text (see `matching.ts`). Omitted when the file/mapping has none. */
  referenceColumn?: string;
  dateFormat: CsvDateFormat;
  decimalSeparator: CsvDecimalSeparator;
}
