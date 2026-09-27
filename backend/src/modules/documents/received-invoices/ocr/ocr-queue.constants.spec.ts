/**
 * `readReceivedInvoiceOcrConcurrency` in isolation — mirrors
 * `queue/queue.constants.spec.ts#readDocumentActionQueueAttempts` almost verbatim: the value it
 * returns feeds `@Processor()`'s own `concurrency` option directly, so anything that is not a positive
 * integer must fall back to the default rather than silently stopping the worker from consuming a job
 * at all (a concurrency of `0`/`NaN`).
 */
import {
  DEFAULT_RECEIVED_INVOICE_OCR_CONCURRENCY,
  readReceivedInvoiceOcrConcurrency,
} from './ocr-queue.constants';

describe('readReceivedInvoiceOcrConcurrency', () => {
  const ORIGINAL = process.env.RECEIVED_INVOICE_OCR_CONCURRENCY;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.RECEIVED_INVOICE_OCR_CONCURRENCY;
    else process.env.RECEIVED_INVOICE_OCR_CONCURRENCY = ORIGINAL;
  });

  it('defaults to 1 when unset', () => {
    delete process.env.RECEIVED_INVOICE_OCR_CONCURRENCY;
    expect(readReceivedInvoiceOcrConcurrency()).toBe(1);
    expect(DEFAULT_RECEIVED_INVOICE_OCR_CONCURRENCY).toBe(1);
  });

  it('reads an override from the environment', () => {
    process.env.RECEIVED_INVOICE_OCR_CONCURRENCY = '4';
    expect(readReceivedInvoiceOcrConcurrency()).toBe(4);
  });

  // A concurrency of `0` (or anything else non-positive) would silently stop this worker from ever
  // consuming an OCR job at all — every upload left "pending" forever with nothing in the logs to
  // explain why. A malformed value must therefore fall back to the default, never reach `@Processor()`.
  it.each([
    'four',
    '',
    'NaN',
    '0',
    '-1',
  ])('refuses %p and falls back to 1 rather than silently stopping the worker', (value) => {
    process.env.RECEIVED_INVOICE_OCR_CONCURRENCY = value;
    expect(readReceivedInvoiceOcrConcurrency()).toBe(1);
  });
});
