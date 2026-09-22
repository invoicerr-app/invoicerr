import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { BackupQueueWorkerModule } from './modules/backup/backup-queue-worker.module';
import { isBackupEnabled } from './modules/backup/backup.constants';
import { BillingQueueWorkerModule } from './modules/billing/billing-queue-worker.module';
import { isBillingEnabled } from './modules/billing/billing-flag';
import { TransferQueueWorkerModule } from './modules/company/transfer/transfer-queue-worker.module';
import { DocumentsQueueWorkerModule } from './modules/documents/queue/document-queue-worker.module';
import { WebhooksQueueWorkerModule } from './modules/webhooks/queue/webhooks-queue-worker.module';
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
 *
 * `BillingQueueWorkerModule` / `TransferQueueWorkerModule` — the SAME "always import here,
 * `app.module.ts` gates its own inline copy on `workerInline`" shape as `DocumentsQueueWorkerModule`/
 * `BackupQueueWorkerModule` above. BEFORE this split, `BillingModule`/`TransferModule` were imported
 * ONLY by `AppModule` — a dedicated worker process had NO WAY to consume `Q_BILLING_LIFECYCLE` or
 * `Q_COMPANY_TRANSFER` at all, so both sweeps always ran on an API replica regardless of how many
 * dedicated workers existed. `BillingQueueWorkerModule` is still gated on `isBillingEnabled()` — the
 * same "invisible and inert without its flag" contract `app.module.ts`'s own `billingEnabled` already
 * holds; `TransferQueueWorkerModule` has no such flag (transfer works in self-hosted mode too).
 *
 * `WebhooksQueueWorkerModule` — same shape again: outbound-webhook delivery used to happen inline, in
 * whichever request or job dispatched the event, so a dedicated worker process never touched it either.
 * No flag (webhooks work in self-hosted mode too, same posture as `TransferQueueWorkerModule`).
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    DocumentsQueueWorkerModule,
    ...(isBackupEnabled() ? [BackupQueueWorkerModule] : []),
    ...(isBillingEnabled() ? [BillingQueueWorkerModule] : []),
    TransferQueueWorkerModule,
    WebhooksQueueWorkerModule,
  ],
})
export class WorkerModule {}
