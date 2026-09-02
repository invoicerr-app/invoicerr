import { DocumentQueueDispatcher } from './document-queue.dispatcher';
import { DocumentActionJobData } from './queue.constants';
import { ScheduleOccurrenceJobData } from '../schedules/schedule-sweep';
import { ReportJobData } from '../reporting/report-job';

/**
 * `DocumentQueueDispatcher` against a FAKE `Queue` (no BullMQ, no Redis) — proves the idempotent
 * "clear a terminal job before re-adding" logic and the deterministic jobId this class is actually
 * responsible for, without a broker. The real enqueue -> consume round trip is
 * queue/__tests__/document-action-queue.redis.spec.ts (gated on REDIS_URL).
 */
function fakeQueue() {
  return {
    getJob: jest.fn(),
    add: jest.fn().mockResolvedValue(undefined),
  };
}

const INPUT: DocumentActionJobData = {
  companyId: 'company-1',
  typeId: 'quote',
  documentId: 'doc-1',
  actionId: 'send',
  payload: { data: {}, params: {} },
};

describe('DocumentQueueDispatcher.enqueueAction', () => {
  afterEach(() => jest.resetAllMocks());

  it('adds the job under its deterministic jobId when nothing exists under it yet', async () => {
    const queue = fakeQueue();
    queue.getJob.mockResolvedValue(undefined);
    const dispatcher = new DocumentQueueDispatcher(queue as never);

    await dispatcher.enqueueAction(INPUT);

    expect(queue.add).toHaveBeenCalledWith(
      'run',
      INPUT,
      expect.objectContaining({ jobId: 'send-quote-doc-1' }),
    );
  });

  it.each([
    'completed',
    'failed',
  ])('clears a TERMINAL (%s) job under the same id before adding a fresh one', async (state) => {
    const queue = fakeQueue();
    const existing = { getState: jest.fn().mockResolvedValue(state), remove: jest.fn() };
    queue.getJob.mockResolvedValue(existing);
    const dispatcher = new DocumentQueueDispatcher(queue as never);

    await dispatcher.enqueueAction(INPUT);

    expect(existing.remove).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalled();
  });

  it.each([
    'waiting',
    'active',
    'delayed',
  ])('leaves a still IN-FLIGHT (%s) job alone — never enqueues a duplicate', async (state) => {
    const queue = fakeQueue();
    const existing = { getState: jest.fn().mockResolvedValue(state), remove: jest.fn() };
    queue.getJob.mockResolvedValue(existing);
    const dispatcher = new DocumentQueueDispatcher(queue as never);

    await dispatcher.enqueueAction(INPUT);

    expect(existing.remove).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });
});

const OCCURRENCE_DATA: ScheduleOccurrenceJobData = {
  scheduleId: 'sched-1',
  companyId: 'company-1',
  typeId: 'invoice',
  documentId: 'doc-1',
  actionId: 'duplicate',
  occurrenceAt: '2026-09-30T00:00:00.000Z',
  payload: { data: {}, params: { occurrenceDate: '2026-09-30T00:00:00.000Z' } },
};

describe('DocumentQueueDispatcher.enqueueScheduleOccurrence', () => {
  afterEach(() => jest.resetAllMocks());

  it('enqueues under the given jobId, on the occurrence job name, when nothing exists under it yet', async () => {
    const queue = fakeQueue();
    queue.getJob.mockResolvedValue(undefined);
    const dispatcher = new DocumentQueueDispatcher(queue as never);

    const enqueued = await dispatcher.enqueueScheduleOccurrence('schedule-sched-1-1234', OCCURRENCE_DATA);

    expect(enqueued).toBe(true);
    expect(queue.add).toHaveBeenCalledWith(
      'document-schedule-occurrence',
      OCCURRENCE_DATA,
      expect.objectContaining({ jobId: 'schedule-sched-1-1234' }),
    );
  });

  // THE DEDUP PROOF: two overlapping sweeps computing the same jobId for the same occurrence must
  // result in exactly ONE enqueue — see schedule-sweep.ts's own header. Unlike `enqueueAction`, this
  // must skip UNCONDITIONALLY, even for a job already terminal (completed/failed): re-running the
  // exact same occurrence is never a legitimate retry for a schedule.
  it.each([
    'waiting',
    'active',
    'delayed',
    'completed',
    'failed',
  ])('skips unconditionally when a job already exists under this id (%s) — never a duplicate occurrence', async (state) => {
    const queue = fakeQueue();
    const existing = { getState: jest.fn().mockResolvedValue(state), remove: jest.fn() };
    queue.getJob.mockResolvedValue(existing);
    const dispatcher = new DocumentQueueDispatcher(queue as never);

    const enqueued = await dispatcher.enqueueScheduleOccurrence('schedule-sched-1-1234', OCCURRENCE_DATA);

    expect(enqueued).toBe(false);
    expect(existing.remove).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });
});

const REPORT_DATA: ReportJobData = {
  companyId: 'company-1',
  documentId: 'doc-1',
  typeId: 'invoice',
  providerId: 'nav',
};

describe('DocumentQueueDispatcher.enqueueReport', () => {
  afterEach(() => jest.resetAllMocks());

  it('enqueues under the deterministic "report-<providerId>-<documentId>" jobId when nothing exists yet', async () => {
    const queue = fakeQueue();
    queue.getJob.mockResolvedValue(undefined);
    const dispatcher = new DocumentQueueDispatcher(queue as never);

    const enqueued = await dispatcher.enqueueReport(REPORT_DATA);

    expect(enqueued).toBe(true);
    expect(queue.add).toHaveBeenCalledWith(
      'document-report',
      REPORT_DATA,
      expect.objectContaining({ jobId: 'report-nav-doc-1', attempts: expect.any(Number) }),
    );
  });

  // Dédup — THE MUTATION TARGET this task's own brief names: a re-job for the SAME (provider,
  // document) pair must never enqueue a second, independent job — unlike `enqueueAction`, this skip
  // is UNCONDITIONAL, whatever the existing job's state (never "clear a terminal one and retry" —
  // see this method's own header for why a declaration's own retry happens INSIDE the one job, via
  // BullMQ's own attempts, never by re-enqueuing a second job).
  it.each([
    'completed',
    'failed',
    'waiting',
    'active',
    'delayed',
  ])('a job already existing under this id (%s) is left alone — never a duplicate declaration', async (state) => {
    const queue = fakeQueue();
    const existing = { getState: jest.fn().mockResolvedValue(state), remove: jest.fn() };
    queue.getJob.mockResolvedValue(existing);
    const dispatcher = new DocumentQueueDispatcher(queue as never);

    const enqueued = await dispatcher.enqueueReport(REPORT_DATA);

    expect(enqueued).toBe(false);
    expect(existing.remove).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });
});

describe('DocumentQueueDispatcher.registerScheduleSweepRepeatable', () => {
  afterEach(() => jest.resetAllMocks());

  it('registers the ONE sweep job as a repeatable, under its fixed singleton jobId', async () => {
    const queue = fakeQueue();
    const dispatcher = new DocumentQueueDispatcher(queue as never);

    await dispatcher.registerScheduleSweepRepeatable();

    expect(queue.add).toHaveBeenCalledWith(
      'document-schedule-sweep',
      {},
      expect.objectContaining({
        jobId: 'document-schedule-sweep-singleton',
        repeat: { every: expect.any(Number) },
      }),
    );
  });
});
