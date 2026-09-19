/**
 * Providers-only half of hosted billing's queue — split out of `billing.module.ts` so a
 * dedicated `ROLE=worker` process can consume `Q_BILLING_LIFECYCLE` too
 * (`billing-queue-worker.module.ts`, the CONSUMING half), the same Core/HTTP/Worker split
 * `documents-core.module.ts` / `documents.module.ts` / `queue/document-queue-worker.module.ts`
 * already hold, and the same one `backup-core.module.ts` / `backup.module.ts` /
 * `backup-queue-worker.module.ts` hold for a much smaller module.
 *
 * BEFORE this split, `BillingModule` (the module below, unchanged in shape otherwise) was imported
 * ONLY by `AppModule` — `worker.module.ts` never touched it at all, so `BillingLifecycleSweepRunner`'s
 * own repeatable (Polar sync, and its export-and-email-on-block path) always ran on an API replica,
 * competing with request serving, while the target topology's 15 dedicated workers sat idle for it —
 * exactly the "two queues structurally unreachable from the workers" defect this closes.
 *
 * Imports `DocumentsCoreModule` (never the full `DocumentsModule`, which also carries the HTTP
 * controller/SSE bridge this feature has no use for) for `DocumentsService` alone —
 * `BillingExportService`'s own dependency, the same "Core, not the whole HTTP module" placement
 * `PaymentsModule`/`BankReconciliationModule`/`ClientPortalModule` already hold, each for the exact
 * same reason (see their own module headers).
 *
 * Does NOT register the repeatable itself, and does NOT provide `BillingLifecycleProcessor` — that is
 * the CONSUMING half's own job (`billing-queue-worker.module.ts`), exactly mirroring
 * `documents-core.module.ts` (providers only) versus `document-queue-worker.module.ts` (the
 * `@Processor()` and the `onApplicationBootstrap` repeatable registration). `exports: [BullModule]` is
 * what lets that OTHER module's own `@InjectQueue(Q_BILLING_LIFECYCLE)`/`@Processor()` resolve a
 * connection registered under `BILLING_BULL_CONFIG_KEY` without redefining it — see
 * `queue/billing-queue.constants.ts`'s own header for why an unnamed `forRoot()` here would be a bug.
 */
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { DocumentsCoreModule } from '../documents/documents-core.module';
import { MailService } from '@/mail/mail.service';

import { redisConnection } from '../documents/queue/redis.config';
import { BillingExportService } from './export-zip.service';
import { BillingLifecycleSweepRunner } from './billing-lifecycle-sweep-runner';
import { BILLING_BULL_CONFIG_KEY, Q_BILLING_LIFECYCLE } from './queue/billing-queue.constants';

@Module({
  imports: [
    DocumentsCoreModule,
    BullModule.forRoot(BILLING_BULL_CONFIG_KEY, { connection: redisConnection() }),
    BullModule.registerQueue({ configKey: BILLING_BULL_CONFIG_KEY, name: Q_BILLING_LIFECYCLE }),
  ],
  providers: [MailService, BillingExportService, BillingLifecycleSweepRunner],
  exports: [BullModule, BillingLifecycleSweepRunner],
})
export class BillingCoreModule {}
