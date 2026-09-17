import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { BackupRunner, RunBackupSweepResult } from '../backup-runner';
import { Q_BACKUP } from './backup-queue.constants';

/**
 * The backup queue's ONE processor, ONE job name — mirrors
 * `documents/queue/processors/document-action.processor.ts`'s own "no try/catch here" discipline: a
 * thrown error must propagate so BullMQ records this attempt as failed. In practice
 * `BackupRunner.runSweep()` itself never throws for anything short of "could not even enumerate the
 * sources" (see that file's own header) — a single file failing is recorded in the run's own
 * `errors` and never rethrown here, so this handler completing normally is the overwhelmingly common
 * case even on a run with real per-file failures.
 */
@Processor(Q_BACKUP)
export class BackupProcessor extends WorkerHost {
  private readonly logger = new Logger(BackupProcessor.name);

  constructor(private readonly runner: BackupRunner) {
    super();
  }

  async process(job: Job): Promise<RunBackupSweepResult> {
    this.logger.log(`Running the instance-backup sweep (job ${job.id})`);
    const result = await this.runner.runSweep();
    this.logger.log(
      `Instance-backup sweep ${result.runId} (${result.status}): ${result.filesUploaded} uploaded, ` +
        `${result.filesSkipped} skipped, ${result.filesFailed} failed, ${result.bytesUploaded} bytes.`,
    );
    return result;
  }
}
