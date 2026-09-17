/**
 * Builds the "everything this company ever had" zip — mailed to the OWNER by
 * `billing-lifecycle-sweep-runner.ts` the moment a subscription enters `ZIPPED` (see
 * `lifecycle.ts`'s own header), the company's last real chance to keep a copy before the real,
 * cascading deletion (`deletion.ts`) eventually runs.
 *
 * No existing export was reusable whole: `accounting-export/` builds a CSV LEDGER view (amounts,
 * balances — never the documents' own rendered form or full field data) and `archive/` only holds
 * documents that were actually SENT under a country requiring legal archiving (DE/FR/PL/PT — see
 * `archive/retention/`'s own header), never a draft, a quote, or an invoice from an unarchived
 * country. So this is the documented fallback: one PDF (when the document type/status can render
 * one — see the per-document `try` below) plus one JSON dump of the STORED fields, per document,
 * for literally every `DocumentInstance` row the company has, regardless of type or status.
 *
 * A proper `@Injectable()` (not a plain function like this directory's other billing files) because
 * it needs `DocumentsService`'s own rendering pipeline (`renderInstancePdf`) — a class with its own
 * dozen-odd registries this file has no business reconstructing by hand.
 *
 * BOUNDING (added 2026-09-17 — a live incident, not a hypothetical): a company with a few thousand
 * documents used to build an UNBOUNDED zip — `zip.generateAsync` holds the entire archive in one JS
 * `Buffer` while it compresses — and hand that straight to an email attachment, well past ordinary SMTP
 * limits (10-25 MB). The send then fails, the company stays `BLOCKED`, and the NEXT sweep tick (default:
 * hourly) repeats the exact same unbounded, Chromium-rendering-every-PDF build forever, since nothing
 * about a company's size ever changes on its own. `buildCompanyZip` now streams the archive through
 * `generateNodeStream` into a bounded byte-and-time-capped pipeline instead of one `generateAsync`
 * call: compression happens incrementally rather than holding the whole structure in memory at once,
 * and a company whose export would exceed either cap gets a NAMED error (`ExportZipTooLargeError`/
 * `ExportZipTimedOutError`) the moment it crosses the line, rather than silently finishing an attachment
 * no mail server would ever accept.
 */
import { Injectable } from '@nestjs/common';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
// `jszip` ships an `export = JSZip` (CJS) declaration — a plain `import JSZip from 'jszip'` compiles,
// under ts-jest, to a `.default` access that does not exist on it (`jszip_1.default is not a
// constructor` at runtime); the namespace form (`import * as JSZip`) instead fails `nest build`'s own
// `tsc` outright ("not constructable... consider... import require"). `import X = require(...)` is
// the one form TypeScript itself recommends for `export =` modules and is what actually satisfies
// BOTH — confirmed directly against this exact repo's `nest build` AND `npx jest` while writing this.
import JSZip = require('jszip');

import { DocumentsService } from '../documents/documents.service';
import { listDocuments } from '../documents/persistence';
import { logger } from '@/logger/logger.service';

/** Effectively "no cap" — `listDocuments`'s own default `take` is 50 (the list SCREEN's page-size
 *  budget, persistence.ts's own header), which this export must never inherit: a company with years
 *  of history must get every document, not its 50 most recently touched. */
const EXPORT_TAKE = 1_000_000;

/** Hard ceiling on the ARCHIVE's own compressed bytes — far below the 10-25 MB an ordinary SMTP server
 *  accepts as an attachment, so a company whose documents exceed it fails FAST, with a diagnosable
 *  named error, rather than finishing a build that mailing would only reject anyway (see this file's
 *  own header). Exported so `billing-lifecycle-sweep-runner.ts` and this module's own spec can refer to
 *  the exact same number rather than a duplicated magic constant. */
export const EXPORT_ZIP_MAX_BYTES = 20 * 1024 * 1024; // 20 MiB

/** Hard ceiling on how long ONE company's export may take to build — a large document count rendering
 *  through a slow or unreachable Chromium (`renderInstancePdf`, this file's own header) must not hang a
 *  sweep tick indefinitely; it fails with a named error instead, exactly like exceeding the byte cap. */
export const EXPORT_ZIP_MAX_DURATION_MS = 5 * 60 * 1000; // 5 minutes

/** Thrown (never silently truncated) when the archive's own compressed bytes cross
 *  `EXPORT_ZIP_MAX_BYTES` mid-build — the caller (`billing-lifecycle-sweep-runner.ts`) counts this the
 *  same as any other `zipFailed`, but can log it BY NAME instead of an opaque stream error. */
export class ExportZipTooLargeError extends Error {
  constructor(
    readonly companyId: string,
    readonly maxBytes: number,
  ) {
    super(`Company ${companyId}'s data export exceeded ${maxBytes} bytes while building — aborted.`);
    this.name = 'ExportZipTooLargeError';
  }
}

/** Thrown when building the archive takes longer than `EXPORT_ZIP_MAX_DURATION_MS` — see that
 *  constant's own header. */
export class ExportZipTimedOutError extends Error {
  constructor(
    readonly companyId: string,
    readonly maxDurationMs: number,
  ) {
    super(`Company ${companyId}'s data export took longer than ${maxDurationMs}ms — aborted.`);
    this.name = 'ExportZipTimedOutError';
  }
}

/** Optional overrides for `BillingExportService.buildCompanyZip`'s own bounds — every field defaults to
 *  the module-level constant above. `now` is an internal testing seam only (same convention as this
 *  module family's `now: Date = new Date()` parameters elsewhere, e.g. `company-subscription.store.ts`):
 *  production code never has a reason to pass it. */
export interface ExportZipLimits {
  maxBytes?: number;
  maxDurationMs?: number;
  now?: () => number;
}

/**
 * Streams `zip`'s own compressed output into a fresh temp file, counting bytes as they are produced —
 * NEVER via `generateAsync` (which assembles the entire archive as one in-memory `Buffer` before
 * returning it). Aborts the pipeline (deleting whatever partial file exists) the instant either cap is
 * crossed, so a runaway company never finishes a build only to be rejected at the mail step, and never
 * grows this process's own memory unboundedly while trying. Returns the temp file's own directory so
 * the caller can clean it up once done reading it back.
 */
async function streamZipToTempFile(
  zip: JSZip,
  companyId: string,
  maxBytes: number,
  maxDurationMs: number,
  now: () => number = Date.now,
): Promise<{ dir: string; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'invoicerr-billing-export-'));
  const path = join(dir, 'export.zip');
  const startedAt = now();
  let bytesWritten = 0;

  // A plain counting/guarding pass-through — the archive's bytes are never inspected or altered, only
  // counted and timed, so this adds no meaningful overhead to the compression `generateNodeStream`
  // itself performs.
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
      // Best-effort cleanup only — the temp directory is OS-reaped eventually either way, and a
      // failure to delete it early must never mask the real error (`ExportZipTooLargeError`, e.g.)
      // this function was already about to throw.
    });
    throw error;
  }

  return { dir, path };
}

@Injectable()
export class BillingExportService {
  constructor(private readonly documentsService: DocumentsService) {}

  /** The zip's bytes, ready to attach to an outgoing email. Never throws for a single document that
   *  fails to render (an incomplete draft missing a required field, e.g.) — that document's JSON
   *  still lands in the zip, just without a `.pdf` beside it, logged rather than aborting the WHOLE
   *  export over one bad row. A genuinely fatal error DOES propagate: the initial `listDocuments`
   *  query, the zip library itself, or — new as of 2026-09-17 — this company's own export crossing
   *  `EXPORT_ZIP_MAX_BYTES`/`EXPORT_ZIP_MAX_DURATION_MS` (`ExportZipTooLargeError`/
   *  `ExportZipTimedOutError`, this file's own header). Callers that walk MANY companies (the billing
   *  lifecycle sweep) must catch per company — one company's export failing, of any kind, must never
   *  stop the rest of the pass; see `billing-lifecycle-sweep-runner.ts#sendZipToOwner`'s own try/catch. */
  async buildCompanyZip(companyId: string, limits: ExportZipLimits = {}): Promise<Buffer> {
    const zip = new JSZip();
    const documents = await listDocuments(companyId, undefined, EXPORT_TAKE);

    for (const doc of documents) {
      const dir = `${doc.typeId}/${doc.number ?? doc.id}`;
      zip.file(`${dir}.json`, JSON.stringify(doc, null, 2));
      try {
        const pdf = await this.documentsService.renderInstancePdf(companyId, doc.typeId, doc.id);
        zip.file(`${dir}.pdf`, pdf);
      } catch (error) {
        logger.warn('Billing export: one document could not be rendered to PDF — JSON only', {
          category: 'billing',
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
        // Same best-effort cleanup rationale as `streamZipToTempFile`'s own catch above.
      });
    }
  }
}
