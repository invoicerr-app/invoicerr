import { vi } from 'vitest';

import { Queue } from 'bullmq';

import { BackupQueueDispatcher } from './backup-queue.dispatcher';
import { BACKUP_SWEEP_JOB_ID, BACKUP_SWEEP_JOB_NAME } from './backup-queue.constants';

/**
 * A fake queue that reproduces the ONE BullMQ behaviour that made a superseded schedule survive a
 * deploy: a repeatable definition is keyed by its own schedule, so re-registering the same job name
 * under a DIFFERENT cron adds a second definition rather than replacing the first. No Redis — the
 * same "fake Queue, real decision" split `documents/queue/document-queue.dispatcher.spec.ts` uses.
 */
function fakeQueue() {
  const schedulers = new Map<string, Record<string, unknown>>();
  return {
    name: 'instance-backup',
    add: vi.fn(
      async (jobName: string, _data: unknown, opts: { jobId?: string; repeat?: Record<string, unknown> }) => {
        if (!opts?.repeat) return;
        const { pattern, tz } = opts.repeat as { pattern?: string; tz?: string };
        const key = `${jobName}:${opts.jobId ?? ''}::${tz ?? ''}:${pattern}`;
        schedulers.set(key, { key, name: jobName, pattern, tz });
      },
    ),
    getJobSchedulers: vi.fn(async () => [...schedulers.values()]),
    removeJobScheduler: vi.fn(async (key: string) => schedulers.delete(key)),
    patterns: () => [...schedulers.values()].map((entry) => entry.pattern).sort(),
  };
}

describe('backup/queue/BackupQueueDispatcher', () => {
  const originalSchedule = process.env.BACKUP_S3_SCHEDULE;

  afterEach(() => {
    if (originalSchedule === undefined) delete process.env.BACKUP_S3_SCHEDULE;
    else process.env.BACKUP_S3_SCHEDULE = originalSchedule;
  });

  it('registers exactly one repeatable, with the default daily-at-03:00-UTC cron pattern', async () => {
    delete process.env.BACKUP_S3_SCHEDULE;
    const queue = fakeQueue();
    const dispatcher = new BackupQueueDispatcher(queue as unknown as Queue);

    await dispatcher.registerBackupSweepRepeatable();

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      BACKUP_SWEEP_JOB_NAME,
      {},
      expect.objectContaining({
        jobId: BACKUP_SWEEP_JOB_ID,
        repeat: { pattern: '0 3 * * *', tz: 'UTC' },
        attempts: 1,
      }),
    );
  });

  it('honours a configured BACKUP_S3_SCHEDULE cron pattern', async () => {
    process.env.BACKUP_S3_SCHEDULE = '0 */6 * * *';
    const queue = fakeQueue();
    const dispatcher = new BackupQueueDispatcher(queue as unknown as Queue);

    await dispatcher.registerBackupSweepRepeatable();

    expect(queue.add).toHaveBeenCalledWith(
      BACKUP_SWEEP_JOB_NAME,
      {},
      expect.objectContaining({ repeat: { pattern: '0 */6 * * *', tz: 'UTC' } }),
    );
  });

  /**
   * The defect these cover: a `BACKUP_S3_SCHEDULE` temporarily set to every minute, reverted, and
   * every pod rolled — and the per-minute sweep kept firing, because the repeatable lives in Redis
   * (which outlives the deployment), is keyed by its own cron expression, and nothing ever removed
   * the superseded key. Registering was idempotent; it was never sufficient.
   */
  describe('retiring a superseded schedule', () => {
    it('leaves ONLY the configured cron registered after the value was changed and the pod rolled', async () => {
      const queue = fakeQueue();
      process.env.BACKUP_S3_SCHEDULE = '* * * * *';
      await new BackupQueueDispatcher(queue as unknown as Queue).registerBackupSweepRepeatable();
      expect(queue.patterns()).toEqual(['* * * * *']);

      process.env.BACKUP_S3_SCHEDULE = '0 3 * * *';
      await new BackupQueueDispatcher(queue as unknown as Queue).registerBackupSweepRepeatable();

      expect(queue.patterns()).toEqual(['0 3 * * *']);
      expect(queue.removeJobScheduler).toHaveBeenCalledTimes(1);
    });

    it('does not touch the schedule it just registered when nothing was superseded', async () => {
      const queue = fakeQueue();
      process.env.BACKUP_S3_SCHEDULE = '0 3 * * *';

      await new BackupQueueDispatcher(queue as unknown as Queue).registerBackupSweepRepeatable();
      await new BackupQueueDispatcher(queue as unknown as Queue).registerBackupSweepRepeatable();

      expect(queue.removeJobScheduler).not.toHaveBeenCalled();
      expect(queue.patterns()).toEqual(['0 3 * * *']);
    });
  });
});
