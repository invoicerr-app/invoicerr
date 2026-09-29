import { ImportOriginalFileRef, ImportableTypeId } from './document-import.types';

/**
 * One row of the CSV bulk import (issue #340): the browser decodes/parses the file and sends rows
 * as plain JSON, the SAME "browser decodes, server is the authority" split
 * `clients/import/client-import.service.ts` already uses. Every column is a plain string (a CSV cell
 * always is) - parsing into the real field shapes (a date, a money value, a VAT rate) happens
 * server-side, inside `document-import-csv.service.ts`, which re-validates every row from scratch and
 * never trusts a previously fetched preview.
 *
 * v1 SCOPE DECISION, made here so it is not re-litigated in review: a CSV row carries AT MOST ONE
 * line item (`lineDescription`/`lineQuantity`/`lineUnit`/`lineUnitPrice`/`lineVatRate`/
 * `lineDiscountPercent`) - a flat spreadsheet row has no natural way to carry a variable number of
 * lines, and the owner's own decision in #340 only ever promises a linked credit note works "when the
 * import carries [lines]" - it does not promise every entry point carries the SAME richness. A
 * multi-line historical invoice needs the per-document form instead (`document-import.controller.ts`).
 * A credit note imported through this CSV is always FREE (no `invoiceId`/`correctedLines` column): a
 * LINKED credit note needs to pick specific rows off a SPECIFIC invoice, which is a per-document
 * decision, not a spreadsheet column - the per-document form covers that case.
 */
export interface DocumentImportCsvRow {
  rowNumber: number;

  issueDate?: string;
  currency?: string;
  notes?: string;

  originalNumber?: string;
  /** Matched against the `fileName` of one of the files uploaded alongside this CSV (case-sensitive,
   *  exact match) - see `document-import-csv.service.ts#preview`'s own header. */
  originalFileName?: string;

  transmissionSdiId?: string;
  transmissionKsefNumber?: string;
  transmissionPaReference?: string;
  transmissionAtcud?: string;

  lineDescription?: string;
  lineQuantity?: string;
  lineUnit?: string;
  lineUnitPrice?: string;
  lineVatRate?: string;
  lineDiscountPercent?: string;

  // Invoice only.
  clientId?: string;
  dueDate?: string;
  clientReference?: string;

  // Credit note only (always FREE - see this file's own header).
  reason?: string;
}

export interface DocumentImportCsvRowResult {
  rowNumber: number;
  status: 'valid' | 'rejected';
  errors?: string[];
}

export interface DocumentImportCsvPreviewResult {
  rows: DocumentImportCsvRowResult[];
  summary: { total: number; willImport: number; rejected: number };
}

export interface DocumentImportCsvConfirmResult {
  imported: number;
  rejected: number;
}

export interface DocumentImportCsvRequest {
  typeId: ImportableTypeId;
  rows: DocumentImportCsvRow[];
  /** Every file uploaded alongside this CSV (via the ordinary `POST /documents/attachments/upload`
   *  endpoint, broadened to accept XML too - `attachments.service.ts#ALLOWED_ATTACHMENT_MIMES`),
   *  keyed by its OWN `fileName` - `originalFileName` on each row is matched against this map's keys. */
  files: Record<string, ImportOriginalFileRef>;
}
