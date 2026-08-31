import { ForbiddenException, Logger } from '@nestjs/common';

import { DocumentsService } from '../../documents.service';
import { DocumentScheduleSweepRunner } from '../../schedules/schedule-sweep-runner';
import { SCHEDULE_OCCURRENCE_JOB_NAME, SCHEDULE_SWEEP_JOB_NAME } from '../../schedules/schedule-sweep';
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

  describe('process() — schedule job names (root TODO item 5)', () => {
    it('a job named after the sweep runs DocumentScheduleSweepRunner.runSweep, never runAction', async () => {
      const runAction = jest.fn();
      const documentsService = { runAction } as unknown as DocumentsService;
      const runSweep = jest.fn().mockResolvedValue({ due: 2, enqueued: 2 });
      const sweepRunner = { runSweep, runOccurrence: jest.fn() } as unknown as DocumentScheduleSweepRunner;
      const processor = new DocumentActionProcessor(documentsService, sweepRunner);
      const job = {
        id: 'sweep-1',
        name: SCHEDULE_SWEEP_JOB_NAME,
        data: {},
      } as unknown as import('bullmq').Job;

      const result = await processor.process(job);

      expect(result).toEqual({ due: 2, enqueued: 2 });
      expect(runSweep).toHaveBeenCalledTimes(1);
      expect(runAction).not.toHaveBeenCalled();
    });

    it('a job named after an occurrence runs DocumentScheduleSweepRunner.runOccurrence with its own data, never runAction directly', async () => {
      const runAction = jest.fn();
      const documentsService = { runAction } as unknown as DocumentsService;
      const runOccurrence = jest.fn().mockResolvedValue({ changed: true, document: undefined });
      const sweepRunner = { runSweep: jest.fn(), runOccurrence } as unknown as DocumentScheduleSweepRunner;
      const processor = new DocumentActionProcessor(documentsService, sweepRunner);
      const occurrenceData = {
        scheduleId: 'sched-1',
        companyId: 'company-1',
        typeId: 'invoice',
        documentId: 'doc-1',
        actionId: 'duplicate',
        occurrenceAt: '2026-08-31T00:00:00.000Z',
        payload: { data: {}, params: { occurrenceDate: '2026-08-31T00:00:00.000Z' } },
      };
      const job = {
        id: 'occ-1',
        name: SCHEDULE_OCCURRENCE_JOB_NAME,
        data: occurrenceData,
      } as unknown as import('bullmq').Job;

      await processor.process(job);

      expect(runOccurrence).toHaveBeenCalledWith(occurrenceData);
      expect(runAction).not.toHaveBeenCalled();
    });

    it('throws a named error for a schedule job when no sweepRunner was wired — never silently no-ops', async () => {
      const documentsService = { runAction: jest.fn() } as unknown as DocumentsService;
      const processor = new DocumentActionProcessor(documentsService); // no sweepRunner, like every pre-existing spec here
      const job = {
        id: 'sweep-1',
        name: SCHEDULE_SWEEP_JOB_NAME,
        data: {},
      } as unknown as import('bullmq').Job;

      await expect(processor.process(job)).rejects.toThrow(/DocumentScheduleSweepRunner/);
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

    // The structural belt: whatever reason markSendFailed might still throw for (its own
    // "document no longer exists" case is the FIRST belt, in mark-send-failed.ts itself — this test
    // proves the SECOND, unconditional one right here). `onFailed` is a BullMQ `@OnWorkerEvent`
    // listener, not a retried job attempt: if it let an exception escape, that becomes an unhandled
    // promise rejection, and Node kills the ENTIRE process for it — exactly what happened twice on
    // 2026-08-31. If the try/catch around `markSendFailed` were ever removed, this test would fail via
    // an unhandled rejection rather than a clean assertion failure — see the mutation note below.
    it('never rejects even if markSendFailed itself throws — logs the error instead of taking the process down', async () => {
      const documentsService = {
        runAction: jest.fn(),
        getType: jest.fn().mockReturnValue({ id: 'quote' }),
      } as unknown as DocumentsService;
      const processor = new DocumentActionProcessor(documentsService);
      const job = fakeJob(JOB_DATA, { attemptsMade: 3, attempts: 3 });
      const loggerErrorSpy = jest
        .spyOn((processor as unknown as { logger: Logger }).logger, 'error')
        .mockImplementation(() => undefined);
      (markSendFailedModule.markSendFailed as jest.Mock).mockRejectedValue(
        new Error('markSendFailed blew up unexpectedly'),
      );

      await expect(processor.onFailed(job, new Error('SMTP connection refused'))).resolves.toBeUndefined();

      expect(loggerErrorSpy).toHaveBeenCalledWith(expect.stringContaining('markSendFailed itself failed'));
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('markSendFailed blew up unexpectedly'),
      );
    });

    it('is a no-op for an undefined job (BullMQ can hand this event no job at all)', async () => {
      const documentsService = { runAction: jest.fn() } as unknown as DocumentsService;
      const processor = new DocumentActionProcessor(documentsService);

      await expect(processor.onFailed(undefined, new Error('x'))).resolves.toBeUndefined();
      expect(markSendFailedModule.markSendFailed).not.toHaveBeenCalled();
    });

    it.each([
      SCHEDULE_SWEEP_JOB_NAME,
      SCHEDULE_OCCURRENCE_JOB_NAME,
    ])('never calls markSendFailed for a "%s" job — its own failure is recorded elsewhere (DocumentScheduleSweepRunner)', async (jobName) => {
      const documentsService = { runAction: jest.fn(), getType: jest.fn() } as unknown as DocumentsService;
      const processor = new DocumentActionProcessor(documentsService);
      const job = {
        id: 'x',
        name: jobName,
        data: { companyId: 'c', typeId: 'invoice', documentId: 'd', actionId: 'duplicate' },
        attemptsMade: 1,
        opts: { attempts: 1 },
      } as unknown as import('bullmq').Job<DocumentActionJobData>;

      await processor.onFailed(job, new Error('boom'));

      expect(markSendFailedModule.markSendFailed).not.toHaveBeenCalled();
    });
  });
});
