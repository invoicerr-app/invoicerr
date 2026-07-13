import { ForbiddenException, HttpException } from '@nestjs/common';
import { InboundInvoiceController } from './inbound-invoice.controller';

/**
 * Phase 4 (QUEUE_IMPL_PLAN.md §5.9) — POST /compliance/documents/:id/retry.
 *
 * Mirrors the EXACT ownership pattern already proven by refreshDocument() (same file): load the
 * document via the Prisma-backed docStore, 404 if it doesn't exist, then compare
 * `doc.ctx.supplierCompanyId` against the caller's `@ActiveCompany()` id — NOT the URL's `:id` param
 * (which only ever names the document, never the company). Unlike a brand-new pattern, this test
 * asserts the SAME exception `refreshDocument()` throws today for a foreign tenant
 * (`ForbiddenException`, 403) — copied verbatim rather than invented.
 *
 * Offline unit spec: docStore/dispatcher are hand-rolled jest.fn() doubles (same style as
 * compliance-pipeline.service.spec.ts's fake `prisma`), no Redis/Postgres required.
 */
describe('InboundInvoiceController.retryDocument', () => {
  let controller: InboundInvoiceController;
  let docStore: { get: jest.Mock };
  let dispatcher: { enqueueTransmit: jest.Mock };

  const COMPANY = 'company-1';

  beforeEach(() => {
    docStore = { get: jest.fn() };
    dispatcher = { enqueueTransmit: jest.fn().mockResolvedValue(undefined) };
    controller = new InboundInvoiceController(
      {} as any, // InboundInvoiceService — unused by retryDocument
      {} as any, // PollScheduler — unused by retryDocument
      docStore as any,
      dispatcher as any,
    );
  });

  it('TRANSMISSION_FAILED → enqueues a compliance-transmit retry (deterministic jobId ⇒ no double)', async () => {
    docStore.get.mockResolvedValue({
      id: 'doc-1',
      status: 'TRANSMISSION_FAILED',
      ctx: { supplierCompanyId: COMPANY },
    });

    const result = await controller.retryDocument(COMPANY, 'doc-1');

    expect(dispatcher.enqueueTransmit).toHaveBeenCalledTimes(1);
    expect(dispatcher.enqueueTransmit).toHaveBeenCalledWith('doc-1');
    expect(result).toMatchObject({ documentId: 'doc-1', status: 'TRANSMISSION_FAILED', enqueued: true });
  });

  it('wrong status (e.g. already DELIVERED) → rejected, never enqueues', async () => {
    docStore.get.mockResolvedValue({
      id: 'doc-2',
      status: 'DELIVERED',
      ctx: { supplierCompanyId: COMPANY },
    });

    await expect(controller.retryDocument(COMPANY, 'doc-2')).rejects.toThrow(HttpException);
    await expect(controller.retryDocument(COMPANY, 'doc-2')).rejects.toMatchObject({
      status: 409,
    });
    expect(dispatcher.enqueueTransmit).not.toHaveBeenCalled();
  });

  it('wrong tenant → ForbiddenException (403), never enqueues — same guard as refreshDocument()', async () => {
    docStore.get.mockResolvedValue({
      id: 'doc-3',
      status: 'TRANSMISSION_FAILED',
      ctx: { supplierCompanyId: 'someone-elses-company' },
    });

    await expect(controller.retryDocument(COMPANY, 'doc-3')).rejects.toThrow(ForbiddenException);
    expect(dispatcher.enqueueTransmit).not.toHaveBeenCalled();
  });

  it('unknown document → 404, never enqueues', async () => {
    docStore.get.mockResolvedValue(null);

    await expect(controller.retryDocument(COMPANY, 'missing')).rejects.toThrow(HttpException);
    await expect(controller.retryDocument(COMPANY, 'missing')).rejects.toMatchObject({ status: 404 });
    expect(dispatcher.enqueueTransmit).not.toHaveBeenCalled();
  });
});
