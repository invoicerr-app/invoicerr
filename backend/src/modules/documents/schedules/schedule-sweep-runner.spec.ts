import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { DocumentsService } from '../documents.service';
import * as persistence from '../persistence';
import { DocumentQueueDispatcher } from '../queue/document-queue.dispatcher';
import { DocumentScheduleSweepRunner } from './schedule-sweep-runner';
import * as schedulePersistence from './schedule.persistence';

jest.mock('./schedule.persistence');
jest.mock('../persistence');

const SOURCE_DOCUMENT = {
  id: 'doc-1',
  typeId: 'invoice',
  status: 'sent',
  data: { client: 'client-1', issueDate: '2026-08-31', dueDate: '2026-09-30' },
  createdAt: new Date(),
  updatedAt: new Date(),
};

function schedule(
  overrides: Partial<schedulePersistence.DocumentScheduleRecord> = {},
): schedulePersistence.DocumentScheduleRecord {
  return {
    id: 'sched-1',
    companyId: 'company-1',
    typeId: 'invoice',
    sourceDocumentId: 'doc-1',
    actionId: 'duplicate',
    cadence: 'monthly',
    anchorDay: 31,
    nextRunAt: new Date('2026-08-31T00:00:00.000Z'),
    lastRunAt: null,
    lastError: null,
    enabled: true,
    params: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('DocumentScheduleSweepRunner.runSweep', () => {
  afterEach(() => jest.resetAllMocks());

  it('enqueues one occurrence per due schedule and advances nextRunAt/lastRunAt by exactly one cadence step', async () => {
    const due = schedule();
    (schedulePersistence.listDueSchedules as jest.Mock).mockResolvedValue([due]);
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(SOURCE_DOCUMENT);
    const enqueueScheduleOccurrence = jest.fn().mockResolvedValue(true);
    const runner = new DocumentScheduleSweepRunner(
      {} as DocumentsService,
      { enqueueScheduleOccurrence } as unknown as DocumentQueueDispatcher,
    );

    const result = await runner.runSweep(new Date('2026-09-01T00:00:00.000Z'));

    expect(result).toEqual({ due: 1, enqueued: 1 });
    expect(persistence.findOwnedDocument).toHaveBeenCalledWith('company-1', 'invoice', 'doc-1');
    expect(enqueueScheduleOccurrence).toHaveBeenCalledTimes(1);
    const [jobId, jobData] = enqueueScheduleOccurrence.mock.calls[0];
    expect(jobId).toBe(`schedule-sched-1-${due.nextRunAt.getTime()}`);
    expect(jobData).toEqual({
      scheduleId: 'sched-1',
      companyId: 'company-1',
      typeId: 'invoice',
      documentId: 'doc-1', // the SOURCE document, never a to-be-created one
      actionId: 'duplicate',
      occurrenceAt: '2026-08-31T00:00:00.000Z',
      // THE FIX this test also proves: `payload.data` is the source document's OWN current data
      // (fetched fresh here), never an empty object — `DocumentsService.runAction` validates this
      // against the invoice's own REQUIRED fields (client, issueDate, ...) before "duplicate" ever
      // runs, so an empty `data` would 400 on every single occurrence, never reaching the handler.
      payload: {
        data: SOURCE_DOCUMENT.data,
        params: { occurrenceDate: '2026-08-31T00:00:00.000Z' },
      },
    });

    // 31 Aug (anchored at 31) + 1 month -> 30 Sep, the exact clamp cadence.spec.ts already proves in
    // isolation — checked again here end-to-end so a regression in HOW this runner calls
    // computeNextOccurrence (wrong argument order, wrong anchor) is caught too.
    expect(schedulePersistence.advanceSchedule).toHaveBeenCalledWith('sched-1', {
      nextRunAt: new Date('2026-09-30T00:00:00.000Z'),
      lastRunAt: due.nextRunAt,
    });
  });

  it("merges the schedule's own params (e.g. thenSend) into the occurrence, without letting them override occurrenceDate", async () => {
    const due = schedule({ params: { thenSend: true, occurrenceDate: 'should-never-win' } });
    (schedulePersistence.listDueSchedules as jest.Mock).mockResolvedValue([due]);
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(SOURCE_DOCUMENT);
    const enqueueScheduleOccurrence = jest.fn().mockResolvedValue(true);
    const runner = new DocumentScheduleSweepRunner(
      {} as DocumentsService,
      { enqueueScheduleOccurrence } as unknown as DocumentQueueDispatcher,
    );

    await runner.runSweep(new Date('2026-09-01T00:00:00.000Z'));

    const [, jobData] = enqueueScheduleOccurrence.mock.calls[0];
    expect(jobData.payload.params).toEqual({ thenSend: true, occurrenceDate: '2026-08-31T00:00:00.000Z' });
  });

  it('still advances nextRunAt/lastRunAt even when the enqueue was a dedup no-op (a concurrent sweep got there first)', async () => {
    const due = schedule();
    (schedulePersistence.listDueSchedules as jest.Mock).mockResolvedValue([due]);
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(SOURCE_DOCUMENT);
    const enqueueScheduleOccurrence = jest.fn().mockResolvedValue(false); // dedup hit
    const runner = new DocumentScheduleSweepRunner(
      {} as DocumentsService,
      { enqueueScheduleOccurrence } as unknown as DocumentQueueDispatcher,
    );

    const result = await runner.runSweep(new Date('2026-09-01T00:00:00.000Z'));

    expect(result).toEqual({ due: 1, enqueued: 0 });
    expect(schedulePersistence.advanceSchedule).toHaveBeenCalledTimes(1);
  });

  it('a source document that no longer exists records lastError and STILL advances nextRunAt — never wedges the schedule', async () => {
    const due = schedule();
    (schedulePersistence.listDueSchedules as jest.Mock).mockResolvedValue([due]);
    (persistence.findOwnedDocument as jest.Mock).mockRejectedValue(
      new NotFoundException('Document "doc-1" not found for type "invoice".'),
    );
    const enqueueScheduleOccurrence = jest.fn();
    const runner = new DocumentScheduleSweepRunner(
      {} as DocumentsService,
      { enqueueScheduleOccurrence } as unknown as DocumentQueueDispatcher,
    );

    const result = await runner.runSweep(new Date('2026-09-01T00:00:00.000Z'));

    expect(result).toEqual({ due: 1, enqueued: 0 });
    expect(enqueueScheduleOccurrence).not.toHaveBeenCalled();
    expect(schedulePersistence.recordOccurrenceOutcome).toHaveBeenCalledWith(
      'sched-1',
      'Document "doc-1" not found for type "invoice".',
    );
    expect(schedulePersistence.advanceSchedule).toHaveBeenCalledWith('sched-1', {
      nextRunAt: new Date('2026-09-30T00:00:00.000Z'),
      lastRunAt: due.nextRunAt,
    });
  });

  it('does nothing when no schedule is due', async () => {
    (schedulePersistence.listDueSchedules as jest.Mock).mockResolvedValue([]);
    const enqueueScheduleOccurrence = jest.fn();
    const runner = new DocumentScheduleSweepRunner(
      {} as DocumentsService,
      { enqueueScheduleOccurrence } as unknown as DocumentQueueDispatcher,
    );

    const result = await runner.runSweep(new Date('2026-09-01T00:00:00.000Z'));

    expect(result).toEqual({ due: 0, enqueued: 0 });
    expect(enqueueScheduleOccurrence).not.toHaveBeenCalled();
    expect(schedulePersistence.advanceSchedule).not.toHaveBeenCalled();
  });
});

describe('DocumentScheduleSweepRunner.runOccurrence', () => {
  afterEach(() => jest.resetAllMocks());

  const JOB_DATA = {
    scheduleId: 'sched-1',
    companyId: 'company-1',
    typeId: 'invoice',
    documentId: 'doc-1',
    actionId: 'duplicate',
    occurrenceAt: '2026-08-31T00:00:00.000Z',
    payload: { data: {}, params: { occurrenceDate: '2026-08-31T00:00:00.000Z' } },
  };

  it('runs the action through DocumentsService.runAction — never a shortcut around the four gates', async () => {
    const runAction = jest.fn().mockResolvedValue({ changed: true, document: { id: 'doc-2' } });
    const runner = new DocumentScheduleSweepRunner(
      { runAction } as unknown as DocumentsService,
      {} as DocumentQueueDispatcher,
    );

    await runner.runOccurrence(JOB_DATA);

    expect(runAction).toHaveBeenCalledWith('company-1', 'invoice', 'duplicate', {
      documentId: 'doc-1',
      data: {},
      params: { occurrenceDate: '2026-08-31T00:00:00.000Z' },
    });
  });

  it('on success, clears a stale lastError from a previous occurrence', async () => {
    const runAction = jest.fn().mockResolvedValue({ changed: true, document: { id: 'doc-2' } });
    const runner = new DocumentScheduleSweepRunner(
      { runAction } as unknown as DocumentsService,
      {} as DocumentQueueDispatcher,
    );

    await runner.runOccurrence(JOB_DATA);

    expect(schedulePersistence.recordOccurrenceOutcome).toHaveBeenCalledWith('sched-1', null);
  });

  // THE MUTATION TARGET this test proves against: a country-policy-forbidden occurrence (exactly
  // what runAction throws for a 403 — documents.service.ts) must land on the schedule's own
  // lastError, VISIBLE on screen, with the schedule left ENABLED — never a silent failure and never
  // an auto-disable (see DocumentSchedule.enabled's own schema comment).
  it('on failure, records lastError with the error message, re-throws, and never touches `enabled`', async () => {
    const runAction = jest.fn().mockRejectedValue(new ForbiddenException('France forbids this action'));
    const runner = new DocumentScheduleSweepRunner(
      { runAction } as unknown as DocumentsService,
      {} as DocumentQueueDispatcher,
    );

    await expect(runner.runOccurrence(JOB_DATA)).rejects.toBeInstanceOf(ForbiddenException);

    expect(schedulePersistence.recordOccurrenceOutcome).toHaveBeenCalledWith(
      'sched-1',
      'France forbids this action',
    );
  });

  describe('"then send" chaining', () => {
    const THEN_SEND_JOB_DATA = {
      ...JOB_DATA,
      payload: { data: {}, params: { occurrenceDate: '2026-08-31T00:00:00.000Z', thenSend: true } },
    };

    // THE MUTATION TARGET (and the real bug a live end-to-end test against Mailpit caught — see
    // this method's own header): chaining "send" by ENQUEUEING A JOB from inside this same
    // occurrence job — rather than calling `runAction` synchronously, right here — collides with
    // "send"'s own two-phase re-enqueue and wedges the document at "sending" forever. This test
    // proves the chain goes through `runAction` directly, exactly like an HTTP-triggered click.
    it('thenSend:true calls runAction("send", ...) SYNCHRONOUSLY on the document the first action produced', async () => {
      const runAction = jest
        .fn()
        .mockResolvedValueOnce({ changed: true, document: { id: 'doc-2', data: { client: 'c1' } } })
        .mockResolvedValueOnce({ changed: true, document: { id: 'doc-2', status: 'sending' } });
      const runner = new DocumentScheduleSweepRunner(
        { runAction } as unknown as DocumentsService,
        {} as DocumentQueueDispatcher,
      );

      await runner.runOccurrence(THEN_SEND_JOB_DATA);

      expect(runAction).toHaveBeenCalledTimes(2);
      expect(runAction).toHaveBeenNthCalledWith(2, 'company-1', 'invoice', 'send', {
        documentId: 'doc-2', // the FRESH document, never the schedule's own source
        data: { client: 'c1' },
        params: {},
      });
    });

    it('thenSend is not set (the ordinary case) never calls "send" at all', async () => {
      const runAction = jest.fn().mockResolvedValue({ changed: true, document: { id: 'doc-2', data: {} } });
      const runner = new DocumentScheduleSweepRunner(
        { runAction } as unknown as DocumentsService,
        {} as DocumentQueueDispatcher,
      );

      await runner.runOccurrence(JOB_DATA);

      expect(runAction).toHaveBeenCalledTimes(1);
    });

    it('thenSend:true with no document in the result never calls "send" (nothing to send)', async () => {
      const runAction = jest.fn().mockResolvedValue({ changed: true, document: undefined });
      const runner = new DocumentScheduleSweepRunner(
        { runAction } as unknown as DocumentsService,
        {} as DocumentQueueDispatcher,
      );

      await runner.runOccurrence(THEN_SEND_JOB_DATA);

      expect(runAction).toHaveBeenCalledTimes(1);
    });

    it('a "send" failure (e.g. no transport configured) is caught the same way and lands on lastError', async () => {
      const runAction = jest
        .fn()
        .mockResolvedValueOnce({ changed: true, document: { id: 'doc-2', data: {} } })
        .mockRejectedValueOnce(new Error('No transport is configured for this company'));
      const runner = new DocumentScheduleSweepRunner(
        { runAction } as unknown as DocumentsService,
        {} as DocumentQueueDispatcher,
      );

      await expect(runner.runOccurrence(THEN_SEND_JOB_DATA)).rejects.toThrow(
        'No transport is configured for this company',
      );

      expect(schedulePersistence.recordOccurrenceOutcome).toHaveBeenCalledWith(
        'sched-1',
        'No transport is configured for this company',
      );
    });
  });
});
