import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { BackupRunner } from '../backup-runner';
import { BackupSweepJobResult, toBackupSweepJobResult } from './backup-job-result';
import { Q_BACKUP } from './backup-queue.constants';

/**
 * The backup queue's ONE processor, ONE job name — mirrors
 * `documents/queue/processors/document-action.processor.ts`'s own "no try/catch here" discipline: a
 * thrown error must propagate so BullMQ records this attempt as failed. In practice
 * `BackupRunner.runSweep()` itself never throws for anything short of "could not even enumerate the
 * sources" (see that file's own header) — a single file failing is recorded in the run's own
 * `errors` and never rethrown here, so this handler completing normally is the overwhelmingly common
 * case even on a run with real per-file failures.
 *
 * What this handler RETURNS is deliberately not the runner's own result object: BullMQ serialises a
 * return value with `JSON.stringify`, which throws on the `bigint` that result carries, so returning
 * it verbatim failed every sweep job AFTER the sweep itself had succeeded. See
 * `backup-job-result.ts`'s own header for that failure mode in full, and for why the conversion
 * belongs at this boundary rather than inside the runner.
 */
@Processor(Q_BACKUP)
export class BackupProcessor extends WorkerHost {
  private readonly logger = new Logger(BackupProcessor.name);

  constructor(private readonly runner: BackupRunner) {
    super();
  }

  async process(job: Job): Promise<BackupSweepJobResult> {
    this.logger.log(`Running the instance-backup sweep (job ${job.id})`);
    const result = await this.runner.runSweep();
    this.logger.log(
      `Instance-backup sweep ${result.runId} (${result.status}): ${result.filesUploaded} uploaded, ` +
        `${result.filesSkipped} skipped, ${result.filesFailed} failed, ${result.bytesUploaded} bytes.`,
    );
    return toBackupSweepJobResult(result);
  }
}
