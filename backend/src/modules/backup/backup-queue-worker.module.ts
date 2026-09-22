import { Module, OnApplicationBootstrap } from '@nestjs/common';

import { BackupCoreModule } from './backup-core.module';
import { BackupQueueDispatcher } from './queue/backup-queue.dispatcher';
import { BackupProcessor } from './queue/backup.processor';

/**
 * The CONSUMING half of the backup queue — imported unconditionally by `WorkerModule` (`ROLE=worker`)
 * and, inline, by `AppModule` when `WORKER_INLINE !== 'false'`, the exact same
 * `workerInline`/`DocumentsQueueWorkerModule` split `app.module.ts` already documents for the
 * documents queue. Both call sites additionally gate this import on `isBackupEnabled()` — this module
 * is never imported at all with no `BACKUP_S3_BUCKET` configured, so there is nothing further to gate
 * inside it.
 *
 * `onApplicationBootstrap` registers the ONE repeatable, unconditionally: by the time this module is
 * even IN the graph, `isBackupEnabled()` has already been checked once by whichever root module
 * imported it — checking it a second time here would only ever agree with that first check.
 */
@Module({
  imports: [BackupCoreModule],
  providers: [BackupProcessor],
})
export class BackupQueueWorkerModule implements OnApplicationBootstrap {
  constructor(private readonly dispatcher: BackupQueueDispatcher) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.dispatcher.registerBackupSweepRepeatable();
  }
}
