import { vi, type Mock } from 'vitest';

import * as runOcrJobModule from '../../received-invoices/ocr/run-ocr-job';
import { ReceivedInvoiceOcrJobData } from '../../received-invoices/ocr/ocr-queue.constants';
import { ReceivedInvoiceOcrProcessor } from './received-invoice-ocr.processor';

vi.mock('../../received-invoices/ocr/run-ocr-job');

const runReceivedInvoiceOcrJob = runOcrJobModule.runReceivedInvoiceOcrJob as Mock;

/**
 * A thin `@Processor()` shim over `run-ocr-job.ts` — this spec proves ONLY the delegation (job data +
 * the real `DocumentEventsPublisher` are forwarded, the function's own return value is passed through
 * verbatim), never the OCR/backfill logic itself, which `run-ocr-job.spec.ts` already covers in full.
 */
describe('ReceivedInvoiceOcrProcessor.process', () => {
  afterEach(() => vi.resetAllMocks());

  it("delegates to runReceivedInvoiceOcrJob with the job data plus this process's own events publisher", async () => {
    const result = {
      extraction: { syntax: 'OCR', fields: { supplier: 'Acme' } },
      supplierMatch: { outcome: 'unmatched', reason: 'no-criteria' },
      ocr: { outcome: 'extracted', extractorId: 'local-ocr' },
    };
    runReceivedInvoiceOcrJob.mockResolvedValue(result);
    const eventsPublisher = { publish: vi.fn() };
    const processor = new ReceivedInvoiceOcrProcessor(eventsPublisher as never);
    const data: ReceivedInvoiceOcrJobData = {
      companyId: 'company-1',
      fileRef: 'a'.repeat(64),
      fileName: 'invoice.pdf',
      mime: 'application/pdf',
    };

    const returned = await processor.process({ data } as never);

    expect(runReceivedInvoiceOcrJob).toHaveBeenCalledWith({ ...data, events: eventsPublisher });
    expect(returned).toBe(result);
  });

  it('propagates a thrown error rather than swallowing it — BullMQ must record this job as failed', async () => {
    runReceivedInvoiceOcrJob.mockRejectedValue(new Error('file missing'));
    const processor = new ReceivedInvoiceOcrProcessor({ publish: vi.fn() } as never);
    const data: ReceivedInvoiceOcrJobData = {
      companyId: 'company-1',
      fileRef: 'b'.repeat(64),
      fileName: 'invoice.pdf',
      mime: 'application/pdf',
    };

    await expect(processor.process({ data } as never)).rejects.toThrow('file missing');
  });
});
