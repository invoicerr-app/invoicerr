import { Module } from '@nestjs/common';

import { BackupDestination } from './backup-destination';
import { BackupRunner } from './backup-runner';
import { BackupQueueDispatcher } from './queue/backup-queue.dispatcher';
import { BackupQueueModule } from './queue/backup-queue.module';

/**
 * Providers-only half of the backup module — no controller, so a worker process can import JUST this
 * module (`backup-queue-worker.module.ts`) and get the exact same DI-wired `BackupRunner` instance
 * the API uses, never a second, parallel construction of it. The same split
 * `documents/documents-core.module.ts` / `documents/queue/document-queue-worker.module.ts` already
 * hold, applied to this much smaller module.
 */
@Module({
  imports: [BackupQueueModule],
  providers: [BackupDestination, BackupRunner, BackupQueueDispatcher],
  exports: [BackupQueueModule, BackupRunner, BackupQueueDispatcher],
})
export class BackupCoreModule {}
