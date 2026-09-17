import { Job } from 'bullmq';

import { BackupRunner, RunBackupSweepResult } from '../backup-runner';
import { BackupProcessor } from './backup.processor';

describe('backup/queue/BackupProcessor', () => {
  it('delegates to BackupRunner.runSweep and returns its result', async () => {
    const result: RunBackupSweepResult = {
      runId: 'run-1',
      status: 'COMPLETED',
      filesScanned: 2,
      filesUploaded: 1,
      filesSkipped: 1,
      filesFailed: 0,
      bytesUploaded: 10n,
      errors: [],
    };
    const runner = { runSweep: jest.fn().mockResolvedValue(result) } as unknown as BackupRunner;
    const processor = new BackupProcessor(runner);

    const returned = await processor.process({ id: 'job-1' } as Job);

    expect(runner.runSweep).toHaveBeenCalledTimes(1);
    expect(returned).toBe(result);
  });

  it('propagates a thrown error (never swallows it) so BullMQ records the attempt as failed', async () => {
    const runner = {
      runSweep: jest.fn().mockRejectedValue(new Error('could not enumerate sources')),
    } as unknown as BackupRunner;
    const processor = new BackupProcessor(runner);

    await expect(processor.process({ id: 'job-1' } as Job)).rejects.toThrow('could not enumerate sources');
  });
});
