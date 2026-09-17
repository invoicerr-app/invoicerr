import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { BackupQueueWorkerModule } from './modules/backup/backup-queue-worker.module';
import { isBackupEnabled } from './modules/backup/backup.constants';
import { DocumentsQueueWorkerModule } from './modules/documents/queue/document-queue-worker.module';
import { PrismaModule } from './prisma/prisma.module';

/**
 * Root module for the dedicated document-action queue worker process (bootstrapped by worker.ts,
 * `ROLE=worker`) — the documents-module equivalent of the pre-refonte compliance engine's own
 * `WorkerModule` (git tag `avant-refonte-documents`, backend/src/worker.module.ts), rebuilt for
 * the documents module.
 *
 * Deliberately minimal: no controllers, no auth guards, no feature module wired DIRECTLY here — only
 * what the queue processor needs. `DocumentsQueueWorkerModule` itself imports `DocumentsCoreModule`
 * (documents-core.module.ts), which is where `ClientsModule`/`ArticlesModule` actually get pulled in
 * (the entity-reference and transport registries need `ClientsService`/`ArticlesService`) — nothing
 * extra to wire here.
 *
 * `WebhooksModule` is the same story: `DocumentsCoreModule`
 * now imports it too (`documents-core.module.ts`'s own `buildActionRegistry` header) so a "sent"
 * webhook (`INVOICE_SENT`/`QUOTE_SENT`) can actually dispatch from wherever the write itself lands —
 * this worker process included, since `WORKER_INLINE=false` moves that write here entirely.
 *
 * `BackupQueueWorkerModule` — imported unconditionally in THIS module (unlike `app.module.ts`'s own
 * `workerInline`-gated import): a dedicated `ROLE=worker` process is always the one meant to consume
 * every repeatable, backup-sweep included. Still gated on `isBackupEnabled()`
 * (`BACKUP_S3_BUCKET` set) — a worker process booted with no destination bucket configured must stay
 * exactly as inert about backups as the API process is (`app.module.ts`'s own `backupEnabled` gate).
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    DocumentsQueueWorkerModule,
    ...(isBackupEnabled() ? [BackupQueueWorkerModule] : []),
  ],
})
export class WorkerModule {}
