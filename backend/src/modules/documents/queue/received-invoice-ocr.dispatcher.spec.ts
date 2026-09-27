import { vi } from 'vitest';

import { ReceivedInvoiceOcrDispatcher } from './received-invoice-ocr.dispatcher';
import { ReceivedInvoiceOcrJobData } from '../received-invoices/ocr/ocr-queue.constants';

/**
 * `ReceivedInvoiceOcrDispatcher` against a FAKE `Queue` (no BullMQ, no Redis) — the same shape
 * `document-queue.dispatcher.spec.ts` already uses for the document-action queue's own dispatcher.
 */
function fakeQueue() {
  return {
    getJob: vi.fn(),
    add: vi.fn().mockResolvedValue(undefined),
    setGlobalConcurrency: vi.fn().mockResolvedValue(undefined),
  };
}

const INPUT: ReceivedInvoiceOcrJobData = {
  companyId: 'company-1',
  fileRef: 'a'.repeat(64),
  fileName: 'invoice.pdf',
  mime: 'application/pdf',
};

describe('ReceivedInvoiceOcrDispatcher.enqueue', () => {
  afterEach(() => vi.resetAllMocks());

  it('adds the job under its deterministic jobId, with the documented options, when nothing exists yet', async () => {
    const queue = fakeQueue();
    queue.getJob.mockResolvedValue(undefined);
    const dispatcher = new ReceivedInvoiceOcrDispatcher(queue as never);

    await dispatcher.enqueue(INPUT);

    expect(queue.add).toHaveBeenCalledWith(
      'run',
      INPUT,
      expect.objectContaining({
        jobId: `ocr-company-1-${'a'.repeat(64)}`,
        attempts: 1,
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 3600 },
      }),
    );
  });

  it.each([
    'completed',
    'failed',
  ])('clears a TERMINAL (%s) job under the same id before adding a fresh one', async (state) => {
    const queue = fakeQueue();
    const existing = { getState: vi.fn().mockResolvedValue(state), remove: vi.fn() };
    queue.getJob.mockResolvedValue(existing);
    const dispatcher = new ReceivedInvoiceOcrDispatcher(queue as never);

    await dispatcher.enqueue(INPUT);

    expect(existing.remove).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalled();
  });

  it.each([
    'waiting',
    'active',
    'delayed',
  ])('leaves a still IN-FLIGHT (%s) job alone — never enqueues a duplicate', async (state) => {
    const queue = fakeQueue();
    const existing = { getState: vi.fn().mockResolvedValue(state), remove: vi.fn() };
    queue.getJob.mockResolvedValue(existing);
    const dispatcher = new ReceivedInvoiceOcrDispatcher(queue as never);

    await dispatcher.enqueue(INPUT);

    expect(existing.remove).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });
});

describe('ReceivedInvoiceOcrDispatcher.getResult', () => {
  afterEach(() => vi.resetAllMocks());

  it('returns null when no job exists for this (companyId, fileRef) — expired or never enqueued', async () => {
    const queue = fakeQueue();
    queue.getJob.mockResolvedValue(undefined);
    const dispatcher = new ReceivedInvoiceOcrDispatcher(queue as never);

    const result = await dispatcher.getResult('company-1', 'a'.repeat(64));

    expect(result).toBeNull();
    expect(queue.getJob).toHaveBeenCalledWith(`ocr-company-1-${'a'.repeat(64)}`);
  });

  it.each(['waiting', 'active', 'delayed'])('reports pending while the job is %s', async (state) => {
    const queue = fakeQueue();
    queue.getJob.mockResolvedValue({ getState: vi.fn().mockResolvedValue(state) });
    const dispatcher = new ReceivedInvoiceOcrDispatcher(queue as never);

    const result = await dispatcher.getResult('company-1', 'a'.repeat(64));

    expect(result).toEqual({ status: 'pending' });
  });

  it('reads back the completed job\'s own return value verbatim, tagged "done"', async () => {
    const returnvalue = {
      extraction: { syntax: 'OCR', fields: { supplier: 'Acme' } },
      supplierMatch: { outcome: 'unmatched', reason: 'not-found' },
      ocr: { outcome: 'extracted', extractorId: 'local-ocr' },
    };
    const queue = fakeQueue();
    queue.getJob.mockResolvedValue({ getState: vi.fn().mockResolvedValue('completed'), returnvalue });
    const dispatcher = new ReceivedInvoiceOcrDispatcher(queue as never);

    const result = await dispatcher.getResult('company-1', 'a'.repeat(64));

    expect(result).toEqual({ status: 'done', ...returnvalue });
  });

  it('reports the job\'s own failedReason as a named "failed" OcrOutcome, extractorId "unknown"', async () => {
    const queue = fakeQueue();
    queue.getJob.mockResolvedValue({
      getState: vi.fn().mockResolvedValue('failed'),
      failedReason: 'Received-invoice file is no longer on disk.',
    });
    const dispatcher = new ReceivedInvoiceOcrDispatcher(queue as never);

    const result = await dispatcher.getResult('company-1', 'a'.repeat(64));

    expect(result).toEqual({
      status: 'done',
      extraction: { syntax: null, fields: {} },
      supplierMatch: { outcome: 'unmatched', reason: 'no-criteria' },
      ocr: {
        outcome: 'failed',
        extractorId: 'unknown',
        message: 'Received-invoice file is no longer on disk.',
      },
    });
  });

  it('falls back to a generic message when a failed job carries no failedReason at all', async () => {
    const queue = fakeQueue();
    queue.getJob.mockResolvedValue({ getState: vi.fn().mockResolvedValue('failed') });
    const dispatcher = new ReceivedInvoiceOcrDispatcher(queue as never);

    const result = await dispatcher.getResult('company-1', 'a'.repeat(64));

    expect(result).toMatchObject({ ocr: { outcome: 'failed', message: expect.any(String) } });
  });
});

describe('ReceivedInvoiceOcrDispatcher.applyGlobalConcurrency', () => {
  const ORIGINAL = process.env.RECEIVED_INVOICE_OCR_CONCURRENCY;

  afterEach(() => {
    vi.resetAllMocks();
    if (ORIGINAL === undefined) delete process.env.RECEIVED_INVOICE_OCR_CONCURRENCY;
    else process.env.RECEIVED_INVOICE_OCR_CONCURRENCY = ORIGINAL;
  });

  // The cluster-wide cap — BullMQ's OWN enforcement mechanism, not merely each worker's own
  // `@Processor()` concurrency option (see ocr-queue.constants.ts's own header on why that alone is
  // not enough once more than one worker replica shares this queue). Must be called with the SAME
  // configured value `readReceivedInvoiceOcrConcurrency()` feeds the per-worker option, so the two
  // never drift apart.
  it('calls Queue.setGlobalConcurrency with the configured RECEIVED_INVOICE_OCR_CONCURRENCY value', async () => {
    process.env.RECEIVED_INVOICE_OCR_CONCURRENCY = '7';
    const queue = fakeQueue();
    const dispatcher = new ReceivedInvoiceOcrDispatcher(queue as never);

    await dispatcher.applyGlobalConcurrency();

    expect(queue.setGlobalConcurrency).toHaveBeenCalledTimes(1);
    expect(queue.setGlobalConcurrency).toHaveBeenCalledWith(7);
  });

  it('falls back to the default (1) when the env value is unset', async () => {
    delete process.env.RECEIVED_INVOICE_OCR_CONCURRENCY;
    const queue = fakeQueue();
    const dispatcher = new ReceivedInvoiceOcrDispatcher(queue as never);

    await dispatcher.applyGlobalConcurrency();

    expect(queue.setGlobalConcurrency).toHaveBeenCalledWith(1);
  });
});
