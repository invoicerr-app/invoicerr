/**
 * Builds the full-data zip mailed to the owner when a subscription enters `ZIPPED`. Existing exports
 * were not reusable: accounting export is a ledger view and `archive/` only holds legally archived
 * sent documents, so this dumps JSON plus a PDF (when renderable) for every document.
 *
 * The archive is streamed with byte and time caps: an oversized attachment would fail to send and the
 * hourly sweep would rebuild it forever.
 */
import { Injectable } from '@nestjs/common';
import { createWriteStream } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { createTempWorkspace } from '@/lib/temp-workspace';
// `jszip` uses `export =`: the default import breaks under ts-jest and the namespace import fails
// `tsc`, so `import = require` is the only form that works for both.
import JSZip = require('jszip');

import { DocumentsService } from '../documents/documents.service';
import { listAllDocuments } from '../documents/persistence';
import { logger } from '@/logger/logger.service';

/** Well below the 10-25 MB attachment limit of ordinary SMTP servers. */
export const EXPORT_ZIP_MAX_BYTES = 20 * 1024 * 1024; // 20 MiB

/** A slow or unreachable Chromium must not hang a sweep tick indefinitely. */
export const EXPORT_ZIP_MAX_DURATION_MS = 5 * 60 * 1000; // 5 minutes

export class ExportZipTooLargeError extends Error {
  constructor(
    readonly companyId: string,
    readonly maxBytes: number,
  ) {
    super(`Company ${companyId}'s data export exceeded ${maxBytes} bytes while building — aborted.`);
    this.name = 'ExportZipTooLargeError';
  }
}

export class ExportZipTimedOutError extends Error {
  constructor(
    readonly companyId: string,
    readonly maxDurationMs: number,
  ) {
    super(`Company ${companyId}'s data export took longer than ${maxDurationMs}ms — aborted.`);
    this.name = 'ExportZipTimedOutError';
  }
}

/** `now` is a test seam only. */
export interface ExportZipLimits {
  maxBytes?: number;
  maxDurationMs?: number;
  now?: () => number;
}

/** Streams to a temp file instead of `generateAsync`, which would hold the whole archive in memory. */
async function streamZipToTempFile(
  zip: JSZip,
  companyId: string,
  maxBytes: number,
  maxDurationMs: number,
  now: () => number = Date.now,
): Promise<{ dir: string; path: string }> {
  const dir = await createTempWorkspace('invoicerr-billing-export');
  const path = join(dir, 'export.zip');
  const startedAt = now();
  let bytesWritten = 0;

  const guard = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytesWritten += chunk.length;
      if (bytesWritten > maxBytes) {
        callback(new ExportZipTooLargeError(companyId, maxBytes));
        return;
      }
      if (now() - startedAt > maxDurationMs) {
        callback(new ExportZipTimedOutError(companyId, maxDurationMs));
        return;
      }
      callback(null, chunk);
    },
  });

  try {
    await pipeline(
      zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true, compression: 'DEFLATE' }),
      guard,
      createWriteStream(path),
    );
  } catch (error) {
    await rm(dir, { recursive: true, force: true }).catch(() => {
      // Best-effort cleanup; must never mask the error being thrown.
    });
    throw error;
  }

  return { dir, path };
}

@Injectable()
export class BillingExportService {
  constructor(private readonly documentsService: DocumentsService) {}

  /** A document that fails to render still gets its JSON. Size/time cap errors propagate, so callers
   *  walking many companies must catch per company. */
  async buildCompanyZip(companyId: string, limits: ExportZipLimits = {}): Promise<Buffer> {
    const zip = new JSZip();
    // Paged until exhausted: a data takeaway export cannot be capped.
    const documents = await listAllDocuments(companyId);

    for (const doc of documents) {
      const dir = `${doc.typeId}/${doc.number ?? doc.id}`;
      zip.file(`${dir}.json`, JSON.stringify(doc, null, 2));
      try {
        if (doc.status === 'imported') {
          // An imported document's legal copy is its original file, which may not be a PDF and
          // which `renderInstancePdf` refuses to render.
          const original = await this.documentsService.downloadImportOriginal(companyId, doc.typeId, doc.id);
          zip.file(`${doc.typeId}/${original.filename}`, Buffer.from(original.bytes));
        } else {
          const pdf = await this.documentsService.renderInstancePdf(companyId, doc.typeId, doc.id);
          zip.file(`${dir}.pdf`, pdf);
        }
      } catch (error) {
        logger.warn('Billing export: one document could not be rendered to PDF — JSON only', {
          category: 'billing',
          companyId,
          details: {
            companyId,
            documentId: doc.id,
            typeId: doc.typeId,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }

    const { dir: tempDir, path } = await streamZipToTempFile(
      zip,
      companyId,
      limits.maxBytes ?? EXPORT_ZIP_MAX_BYTES,
      limits.maxDurationMs ?? EXPORT_ZIP_MAX_DURATION_MS,
      limits.now,
    );
    try {
      return await readFile(path);
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {
        // Best-effort cleanup.
      });
    }
  }
}
