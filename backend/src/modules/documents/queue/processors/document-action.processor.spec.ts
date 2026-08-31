import { ForbiddenException } from '@nestjs/common';

import { DocumentsService } from '../../documents.service';
import * as markSendFailedModule from '../mark-send-failed';
import { DocumentActionJobData } from '../queue.constants';
import { DocumentActionProcessor } from './document-action.processor';

jest.mock('../mark-send-failed');

/**
 * THE MUTATION TARGET #1: "le worker saute la porte politique pays" — a processor that resolved the
 * `ActionRegistry` handler directly (or any other shortcut around `DocumentsService.runAction`) would
 * make an action forbidden by the country policy run ANYWAY in the worker, even though the API would
 * have refused it with a 403. This spec proves `process()` has NO OTHER WAY to run an action than
 * `runAction` — a fake `DocumentsService` whose `runAction` throws `ForbiddenException` (exactly what
 * a real country-policy refusal looks like — documents.service.ts) makes the job fail, precisely as
 * it must; a mutated processor calling the registry directly would instead swallow or bypass that
 * refusal, and this test would go from red-on-mutation to green.
 */
function fakeJob(data: DocumentActionJobData, overrides: { attemptsMade?: number; attempts?: number } = {}) {
  return {
    id: 'job-1',
    data,
    attemptsMade: overrides.attemptsMade ?? 1,
    opts: { attempts: overrides.attempts ?? 3 },
  } as unknown as import('bullmq').Job<DocumentActionJobData>;
}

const JOB_DATA: DocumentActionJobData = {
  companyId: 'company-1',
  typeId: 'quote',
  documentId: 'doc-1',
  actionId: 'send',
  payload: { data: { client: 'client-1' }, params: { recipient: 'a@b.com' } },
};

describe('DocumentActionProcessor', () => {
  afterEach(() => jest.resetAllMocks());

  describe('process()', () => {
    it('runs the job through DocumentsService.runAction — the SAME entry point the HTTP controller uses, all four gates included', async () => {
      const runAction = jest.fn().mockResolvedValue({ changed: true, document: undefined });
      const documentsService = { runAction } as unknown as DocumentsService;
      const processor = new DocumentActionProcessor(documentsService);

      await processor.process(fakeJob(JOB_DATA));

      expect(runAction).toHaveBeenCalledWith('company-1', 'quote', 'send', {
        documentId: 'doc-1',
        data: { client: 'client-1' },
        params: { recipient: 'a@b.com' },
      });
    });

    it('a country-policy-forbidden action (ForbiddenException from runAction) fails the job attempt — never silently succeeds', async () => {
      const runAction = jest.fn().mockRejectedValue(new ForbiddenException('forbidden for this country'));
      const documentsService = { runAction } as unknown as DocumentsService;
      const processor = new DocumentActionProcessor(documentsService);

      await expect(processor.process(fakeJob(JOB_DATA))).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('returns exactly what runAction returned — no extra transformation of the result', async () => {
      const actionResult = { changed: true, document: { id: 'doc-1', typeId: 'quote', status: 'sent' } };
      const runAction = jest.fn().mockResolvedValue(actionResult);
      const documentsService = { runAction } as unknown as DocumentsService;
      const processor = new DocumentActionProcessor(documentsService);

      await expect(processor.process(fakeJob(JOB_DATA))).resolves.toBe(actionResult);
    });
  });

  describe('onFailed()', () => {
    it('does NOT mark "send_failed" while more retries remain (attemptsMade < attempts)', async () => {
      const documentsService = { runAction: jest.fn(), getType: jest.fn() } as unknown as DocumentsService;
      const processor = new DocumentActionProcessor(documentsService);
      const job = fakeJob(JOB_DATA, { attemptsMade: 1, attempts: 3 });

      await processor.onFailed(job, new Error('transient SMTP hiccup'));

      expect(markSendFailedModule.markSendFailed).not.toHaveBeenCalled();
    });

    // THE MUTATION TARGET #2's OTHER half: if this method (or the deliver path it eventually calls)
    // persisted "sent" on failure instead of calling markSendFailed once retries are exhausted, this
    // is the test that would catch it.
    it('marks "send_failed" once every attempt is exhausted (attemptsMade >= attempts)', async () => {
      const documentsService = {
        runAction: jest.fn(),
        getType: jest.fn().mockReturnValue({ id: 'quote' }),
      } as unknown as DocumentsService;
      const processor = new DocumentActionProcessor(documentsService);
      const job = fakeJob(JOB_DATA, { attemptsMade: 3, attempts: 3 });
      const error = new Error('SMTP connection refused');

      await processor.onFailed(job, error);

      expect(markSendFailedModule.markSendFailed).toHaveBeenCalledWith(expect.any(Function), {
        companyId: 'company-1',
        typeId: 'quote',
        documentId: 'doc-1',
        actionId: 'send',
        error,
      });
    });

    it('is a no-op for an undefined job (BullMQ can hand this event no job at all)', async () => {
      const documentsService = { runAction: jest.fn() } as unknown as DocumentsService;
      const processor = new DocumentActionProcessor(documentsService);

      await expect(processor.onFailed(undefined, new Error('x'))).resolves.toBeUndefined();
      expect(markSendFailedModule.markSendFailed).not.toHaveBeenCalled();
    });
  });
});
