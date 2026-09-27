/**
 * The received-invoice OCR queue's own constants and wire shape — a DEDICATED queue, separate from
 * `Q_DOCUMENT_ACTION` (`queue/queue.constants.ts`), so a burst of OCR jobs (Tesseract, CPU-heavy,
 * seconds per document) can never throttle an ordinary "send" job's own concurrency budget, and vice
 * versa: `received-invoices.service.ts#upload` enqueues here instead of running OCR inside the
 * request — see that file's own header for why.
 */
import { Logger } from '@nestjs/common';

/** Lives next to `received-invoices/ocr/` (never under `queue/`) — this queue exists purely to move
 *  ONE received-invoices concern off the request path; the dispatcher/processor that actually touch
 *  BullMQ still live under `queue/`, the same split every other queue-adjacent constants file in this
 *  codebase holds (`queue/queue.constants.ts` for the document-action queue). */
export const Q_RECEIVED_INVOICE_OCR = 'received-invoice-ocr';

/**
 * One OCR job's data — deliberately NEVER the file bytes (see `run-ocr-job.ts`'s own header: Redis is
 * not file storage). `fileName`/`mime` are carried so the processor can re-derive the exact same
 * `looksLikePdf`/extraction inputs `applyOcrFallback` would have received synchronously — the job
 * re-reads the bytes themselves from `received-invoices/storage.ts` by `(companyId, fileRef, mime)`.
 */
export interface ReceivedInvoiceOcrJobData {
  companyId: string;
  fileRef: string;
  fileName: string;
  mime: string;
}

const concurrencyLogger = new Logger('ReceivedInvoiceOcrQueueConcurrency');

/** The last raw value this module refused, so a misconfigured instance says so ONCE — same reasoning
 *  `queue.constants.ts#refusedAttemptsValue` already documents for the identical shape. */
let refusedConcurrencyValue: string | undefined;

export const DEFAULT_RECEIVED_INVOICE_OCR_CONCURRENCY = 1;

/**
 * How many received-invoice OCR jobs run at once — `RECEIVED_INVOICE_OCR_CONCURRENCY`, default 1 (one
 * Tesseract job at a time; see the Helm chart's own `ocr.resources` comment for why a single OCR
 * container is already sized for exactly that), read here rather than inline at the `@Processor()`
 * decorator so a test can exercise the parsing rule in isolation.
 *
 * This ONE value feeds TWO different caps, deliberately kept equal:
 *  - `@Processor()`'s own `concurrency` option (`received-invoice-ocr.processor.ts`) — how many jobs
 *    THIS process's own worker runs at once;
 *  - `Queue.setGlobalConcurrency` (`ReceivedInvoiceOcrDispatcher.applyGlobalConcurrency`) — the
 *    CLUSTER-WIDE cap BullMQ enforces across every worker consuming this queue, stored in Redis.
 * The per-worker option alone is not enough: with N scaled worker replicas each honoring "1", N OCR
 * requests could still hit the single OCR container at once — the exact scenario a scaled deployment
 * exists to produce. The global cap is what actually bounds load on the OCR container; the per-worker
 * option is kept at the same value so a single-replica deployment behaves identically to before this
 * cap existed, and so neither figure can drift from the other in a config that sets only one of them.
 *
 * Mirrors `queue.constants.ts#readDocumentActionQueueAttempts` exactly — see that function's own
 * header for the full reasoning this one reuses verbatim, applied to a concurrency figure instead of
 * an attempts count: a non-positive-integer value (a typo, an empty string, `0`, a negative number)
 * falls back to the default INSTEAD of reaching `@Processor()`'s own `concurrency` option, because a
 * concurrency of `0` would silently stop this worker from EVER consuming a job at all — every upload
 * left "pending" forever, with nothing in the logs to explain why — and `NaN`/a negative value are
 * simply not concurrency figures `@nestjs/bullmq`'s own `Worker` was ever built to receive. The
 * refusal is logged once, naming the value rejected and the value in force, for the identical reason
 * a silent fallback would leave an operator who asked for `4` running `1` with nothing that says so.
 */
export function readReceivedInvoiceOcrConcurrency(): number {
  const raw = process.env.RECEIVED_INVOICE_OCR_CONCURRENCY;
  if (raw === undefined) return DEFAULT_RECEIVED_INVOICE_OCR_CONCURRENCY;

  const parsed = parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;

  if (refusedConcurrencyValue !== raw) {
    refusedConcurrencyValue = raw;
    concurrencyLogger.warn(
      `RECEIVED_INVOICE_OCR_CONCURRENCY="${raw}" is not a positive integer — using ` +
        `${DEFAULT_RECEIVED_INVOICE_OCR_CONCURRENCY} instead. A non-positive concurrency would stop ` +
        'this worker from ever consuming an OCR job at all.',
    );
  }
  return DEFAULT_RECEIVED_INVOICE_OCR_CONCURRENCY;
}
