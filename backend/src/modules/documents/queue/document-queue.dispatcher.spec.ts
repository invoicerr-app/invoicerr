import { vi } from 'vitest';

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
    getJob: vi.fn(),
    add: vi.fn().mockResolvedValue(undefined),
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
  afterEach(() => vi.resetAllMocks());

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
    const existing = { getState: vi.fn().mockResolvedValue(state), remove: vi.fn() };
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
    const existing = { getState: vi.fn().mockResolvedValue(state), remove: vi.fn() };
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
  afterEach(() => vi.resetAllMocks());

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
    const existing = { getState: vi.fn().mockResolvedValue(state), remove: vi.fn() };
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
  afterEach(() => vi.resetAllMocks());

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

  // Dedup — a re-job for the SAME (provider,
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
    const existing = { getState: vi.fn().mockResolvedValue(state), remove: vi.fn() };
    queue.getJob.mockResolvedValue(existing);
    const dispatcher = new DocumentQueueDispatcher(queue as never);

    const enqueued = await dispatcher.enqueueReport(REPORT_DATA);

    expect(enqueued).toBe(false);
    expect(existing.remove).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });
});

describe('DocumentQueueDispatcher.registerScheduleSweepRepeatable', () => {
  afterEach(() => vi.resetAllMocks());

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

describe('DocumentQueueDispatcher.registerLogPurgeSweepRepeatable', () => {
  afterEach(() => vi.resetAllMocks());

  it('registers the ONE Log-purge sweep job as a repeatable, under its fixed singleton jobId', async () => {
    const queue = fakeQueue();
    const dispatcher = new DocumentQueueDispatcher(queue as never);

    await dispatcher.registerLogPurgeSweepRepeatable();

    expect(queue.add).toHaveBeenCalledWith(
      'log-purge-sweep',
      {},
      expect.objectContaining({
        jobId: 'log-purge-sweep-singleton',
        repeat: { every: expect.any(Number) },
      }),
    );
  });
});

describe('DocumentQueueDispatcher.registerStorageErasureSweepRepeatable', () => {
  afterEach(() => {
    delete process.env.STORAGE_ERASURE_SWEEP_INTERVAL_MS;
    vi.resetAllMocks();
  });

  it('registers the ONE storage-erasure sweep job as a repeatable, under its fixed singleton jobId', async () => {
    const queue = fakeQueue();
    const dispatcher = new DocumentQueueDispatcher(queue as never);

    await dispatcher.registerStorageErasureSweepRepeatable();

    expect(queue.add).toHaveBeenCalledWith(
      'storage-erasure-sweep',
      {},
      expect.objectContaining({
        jobId: 'storage-erasure-sweep-singleton',
        // Daily by default — a statutory retention boundary is measured in years, so this is already
        // far finer resolution than the obligation it discharges has.
        repeat: { every: 24 * 60 * 60 * 1000 },
      }),
    );
  });

  it('honours STORAGE_ERASURE_SWEEP_INTERVAL_MS, the way every sibling sweep honours its own', async () => {
    process.env.STORAGE_ERASURE_SWEEP_INTERVAL_MS = '5000';
    const queue = fakeQueue();

    await new DocumentQueueDispatcher(queue as never).registerStorageErasureSweepRepeatable();

    expect(queue.add).toHaveBeenCalledWith(
      'storage-erasure-sweep',
      {},
      expect.objectContaining({ repeat: { every: 5000 } }),
    );
  });
});

/**
 * A fake queue that keeps the repeatable definitions it is handed, keyed the way BullMQ keys them —
 * by the schedule itself — so re-registering a sweep under a CHANGED interval adds a definition
 * rather than replacing one. That is the behaviour that let a superseded sweep keep firing out of
 * Redis across a whole deploy, and the reason registration alone was never enough.
 */
function fakeQueueWithSchedulers() {
  const schedulers = new Map<string, Record<string, unknown>>();
  return {
    name: 'document-action',
    getJob: vi.fn(),
    add: vi.fn(
      async (jobName: string, _data: unknown, opts: { jobId?: string; repeat?: Record<string, unknown> }) => {
        if (!opts?.repeat) return;
        const { every } = opts.repeat as { every?: number };
        const key = `${jobName}:${opts.jobId ?? ''}:::${every}`;
        schedulers.set(key, { key, name: jobName, every });
      },
    ),
    getJobSchedulers: vi.fn(async () => [...schedulers.values()]),
    removeJobScheduler: vi.fn(async (key: string) => schedulers.delete(key)),
    names: () => [...schedulers.values()].map((entry) => entry.name).sort(),
    entries: () => [...schedulers.values()],
  };
}

describe('DocumentQueueDispatcher.registerSweepRepeatables', () => {
  const ALL_SWEEPS = [
    'archive-retry-sweep',
    'currency-rate-sweep',
    'document-conformity-sweep',
    'document-pdp-reception-sweep',
    'document-reminder-sweep',
    'document-schedule-sweep',
    'log-purge-sweep',
    'storage-erasure-sweep',
  ];

  afterEach(() => {
    delete process.env.DOCUMENT_SCHEDULE_SWEEP_INTERVAL_MS;
    vi.resetAllMocks();
  });

  it('registers every sweep this queue carries, and retires nothing on a first boot', async () => {
    const queue = fakeQueueWithSchedulers();

    await new DocumentQueueDispatcher(queue as never).registerSweepRepeatables();

    expect(queue.names()).toEqual(ALL_SWEEPS);
    expect(queue.removeJobScheduler).not.toHaveBeenCalled();
  });

  it('leaves ONLY the currently configured interval registered after one sweep interval changed', async () => {
    const queue = fakeQueueWithSchedulers();
    process.env.DOCUMENT_SCHEDULE_SWEEP_INTERVAL_MS = '1000';
    await new DocumentQueueDispatcher(queue as never).registerSweepRepeatables();

    process.env.DOCUMENT_SCHEDULE_SWEEP_INTERVAL_MS = '60000';
    await new DocumentQueueDispatcher(queue as never).registerSweepRepeatables();

    expect(queue.names()).toEqual(ALL_SWEEPS);
    const schedule = queue.entries().filter((entry) => entry.name === 'document-schedule-sweep');
    expect(schedule).toHaveLength(1);
    expect(schedule[0].every).toBe(60000);
  });

  it('retires a definition on this queue that no sweep names any more', async () => {
    const queue = fakeQueueWithSchedulers();
    // A sweep that used to be registered here and has since been removed from the code entirely —
    // its definition would otherwise go on firing forever out of Redis.
    await queue.add('retired-sweep', {}, { jobId: 'retired-sweep-singleton', repeat: { every: 5000 } });

    await new DocumentQueueDispatcher(queue as never).registerSweepRepeatables();

    expect(queue.names()).toEqual(ALL_SWEEPS);
    expect(queue.removeJobScheduler).toHaveBeenCalledTimes(1);
  });
});
