/**
 * The CSV bulk import (issue #340) - one row per document, matched against a set of already-uploaded
 * original files by filename. Mirrors `clients/import/client-import.service.ts`'s own shape
 * (`preview` re-validates every row and writes nothing, `confirm` re-validates from scratch and NEVER
 * trusts a previously fetched preview), reusing `DocumentImportService` for every check and every
 * write - this file's own job is ONLY row-to-input mapping and per-row error collection, never a
 * second copy of the validation `DocumentImportService` already owns.
 *
 * Unlike the client import, a failure partway through `confirm` does NOT roll back the whole batch:
 * each row is its own document, imported (or not) independently - a batch of 40 historical invoices
 * where row 17 has a typo should not cost the other 39 their import. This is also why `confirm` is
 * NOT wrapped in one `prisma.$transaction`: `DocumentImportService.importDocument` already writes
 * files to disk/S3 (`archive/storage.ts`) for each row, which cannot participate in a Postgres
 * transaction anyway.
 */
import { Injectable } from '@nestjs/common';

import { ImportDocumentCsvRowError, buildImportInputFromCsvRow } from './document-import-csv-row';
import { DocumentImportService } from './document-import.service';
import {
  DocumentImportCsvConfirmResult,
  DocumentImportCsvPreviewResult,
  DocumentImportCsvRequest,
  DocumentImportCsvRowResult,
} from './document-import-csv.types';

const MAX_IMPORT_ROWS = 500;

@Injectable()
export class DocumentImportCsvService {
  constructor(private readonly importService: DocumentImportService) {}

  private assertWithinCaps(rows: unknown[]): void {
    if (rows.length === 0) {
      throw new ImportDocumentCsvRowError('The file has no data rows to import.');
    }
    if (rows.length > MAX_IMPORT_ROWS) {
      throw new ImportDocumentCsvRowError(
        `This file has ${rows.length} rows, over the ${MAX_IMPORT_ROWS}-row limit a single import can process.`,
      );
    }
  }

  async preview(
    companyId: string,
    request: DocumentImportCsvRequest,
  ): Promise<DocumentImportCsvPreviewResult> {
    this.assertWithinCaps(request.rows);
    const results: DocumentImportCsvRowResult[] = [];

    for (const row of request.rows) {
      try {
        const input = buildImportInputFromCsvRow(companyId, request.typeId, row, request.files);
        await this.importService.validateImportPreview(input);
        results.push({ rowNumber: row.rowNumber, status: 'valid' });
      } catch (error) {
        results.push({ rowNumber: row.rowNumber, status: 'rejected', errors: errorMessages(error) });
      }
    }

    return {
      rows: results,
      summary: {
        total: results.length,
        willImport: results.filter((r) => r.status === 'valid').length,
        rejected: results.filter((r) => r.status === 'rejected').length,
      },
    };
  }

  async confirm(
    companyId: string,
    request: DocumentImportCsvRequest,
  ): Promise<DocumentImportCsvConfirmResult> {
    this.assertWithinCaps(request.rows);
    let imported = 0;
    let rejected = 0;

    for (const row of request.rows) {
      try {
        const input = buildImportInputFromCsvRow(companyId, request.typeId, row, request.files);
        await this.importService.importDocument(input);
        imported += 1;
      } catch {
        // The reason was already surfaced by `preview` (the UI calls it first and never sends a row
        // the human hasn't seen an error for) - `confirm`'s own job is only the count, matching
        // `client-import.service.ts#confirm`'s own posture on this exact point.
        rejected += 1;
      }
    }

    return { imported, rejected };
  }
}

function errorMessages(error: unknown): string[] {
  if (error instanceof ImportDocumentCsvRowError) return [error.message];
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: unknown }).response;
    if (response && typeof response === 'object' && 'errors' in response) {
      const errors = (response as { errors?: unknown }).errors;
      if (Array.isArray(errors)) {
        return errors.map((e) =>
          e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e),
        );
      }
    }
    if (response && typeof response === 'object' && 'message' in response) {
      return [String((response as { message?: unknown }).message)];
    }
  }
  return [error instanceof Error ? error.message : String(error)];
}
