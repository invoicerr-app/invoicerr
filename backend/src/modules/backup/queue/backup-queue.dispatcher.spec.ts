import { Queue } from 'bullmq';

import { BackupQueueDispatcher } from './backup-queue.dispatcher';
import { BACKUP_SWEEP_JOB_ID, BACKUP_SWEEP_JOB_NAME } from './backup-queue.constants';

describe('backup/queue/BackupQueueDispatcher', () => {
  const originalSchedule = process.env.BACKUP_S3_SCHEDULE;

  afterEach(() => {
    if (originalSchedule === undefined) delete process.env.BACKUP_S3_SCHEDULE;
    else process.env.BACKUP_S3_SCHEDULE = originalSchedule;
  });

  it('registers exactly one repeatable, with the default daily-at-03:00-UTC cron pattern', async () => {
    delete process.env.BACKUP_S3_SCHEDULE;
    const add = jest.fn().mockResolvedValue(undefined);
    const dispatcher = new BackupQueueDispatcher({ add } as unknown as Queue);

    await dispatcher.registerBackupSweepRepeatable();

    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
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
    const add = jest.fn().mockResolvedValue(undefined);
    const dispatcher = new BackupQueueDispatcher({ add } as unknown as Queue);

    await dispatcher.registerBackupSweepRepeatable();

    expect(add).toHaveBeenCalledWith(
      BACKUP_SWEEP_JOB_NAME,
      {},
      expect.objectContaining({ repeat: { pattern: '0 */6 * * *', tz: 'UTC' } }),
    );
  });
});
