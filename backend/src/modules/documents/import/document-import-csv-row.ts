/**
 * Maps ONE CSV row (`document-import-csv.types.ts#DocumentImportCsvRow`) into
 * `document-import.service.ts#DocumentImportService`'s own `ImportDocumentInput` - the row-shape
 * knowledge this whole CSV feature needs, kept in one small, pure, synchronous function so
 * `document-import-csv.service.ts` (preview/confirm) never has to know the field vocabulary itself.
 */
import { ImportDocumentInput, ImportOriginalFileRef, ImportableTypeId } from './document-import.types';

export class ImportDocumentCsvRowError extends Error {}

function numberOrUndefined(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** The row's own single line item, when it declares one - see `document-import-csv.types.ts`'s own
 *  header for why a CSV row carries at most one. `undefined` when the row names no line at all (a
 *  bare metadata-only import, still valid for a FREE credit note, refused by the descriptor's own
 *  `lines`/`min: 1` for an invoice - the same message a human typing zero lines into the per-document
 *  form would get, never a second, CSV-only rule). */
function lineFor(row: {
  lineDescription?: string;
  lineQuantity?: string;
  lineUnit?: string;
  lineUnitPrice?: string;
  lineVatRate?: string;
  lineDiscountPercent?: string;
}): Record<string, unknown> | undefined {
  if (!row.lineDescription?.trim()) return undefined;
  const discount = numberOrUndefined(row.lineDiscountPercent);
  return {
    description: row.lineDescription.trim(),
    quantity: numberOrUndefined(row.lineQuantity) ?? 1,
    unit: row.lineUnit?.trim() || 'unit',
    unitPrice: numberOrUndefined(row.lineUnitPrice) ?? 0,
    vatRate: row.lineVatRate?.trim() ?? '0',
    ...(discount !== undefined ? { discountPercent: discount } : {}),
  };
}

export function buildImportInputFromCsvRow(
  companyId: string,
  typeId: ImportableTypeId,
  row: {
    rowNumber: number;
    issueDate?: string;
    currency?: string;
    notes?: string;
    originalNumber?: string;
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
    clientId?: string;
    dueDate?: string;
    clientReference?: string;
    reason?: string;
  },
  files: Record<string, ImportOriginalFileRef>,
): ImportDocumentInput {
  if (!row.originalFileName?.trim()) {
    throw new ImportDocumentCsvRowError(
      `Row ${row.rowNumber}: no "originalFileName" - every row must name one of the files uploaded alongside this CSV.`,
    );
  }
  const originalFile = files[row.originalFileName.trim()];
  if (!originalFile) {
    throw new ImportDocumentCsvRowError(
      `Row ${row.rowNumber}: no uploaded file named "${row.originalFileName.trim()}" - upload it alongside the CSV.`,
    );
  }

  const line = lineFor(row);
  const data: Record<string, unknown> =
    typeId === 'invoice'
      ? {
          client: row.clientId?.trim(),
          issueDate: row.issueDate?.trim(),
          dueDate: row.dueDate?.trim() || row.issueDate?.trim(),
          currency: row.currency?.trim() || 'EUR',
          notes: row.notes?.trim() || undefined,
          clientReference: row.clientReference?.trim() || undefined,
          lines: line ? [line] : [],
        }
      : {
          // Always FREE - see document-import-csv.types.ts's own header: a CSV row never carries
          // "invoice"/"correctedLines", only the per-document form does.
          issueDate: row.issueDate?.trim(),
          currency: row.currency?.trim() || 'EUR',
          notes: row.notes?.trim() || undefined,
          reason: row.reason?.trim() || undefined,
          lines: line ? [line] : [],
        };

  return {
    companyId,
    typeId,
    data,
    originalNumber: row.originalNumber?.trim() ?? '',
    transmissionEvidence: {
      sdiId: row.transmissionSdiId?.trim() || undefined,
      ksefNumber: row.transmissionKsefNumber?.trim() || undefined,
      paReference: row.transmissionPaReference?.trim() || undefined,
      atcud: row.transmissionAtcud?.trim() || undefined,
    },
    originalFile,
  };
}
