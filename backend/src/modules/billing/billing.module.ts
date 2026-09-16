/**
 * Everything hosted-billing needs, wired as ONE module — imported into `app.module.ts` ONLY when
 * `isBillingEnabled()` reads `true` at process boot (a conditional entry in that file's own `imports`
 * array, the exact same `...(condition ? [Module] : [])` shape `WORKER_INLINE`/`envOidcProvider`
 * already use there). With the flag off, this module is never instantiated: its controller (so
 * `GET /api/billing/status` 404s, Nest's own default for an unknown route), its BullMQ queue/
 * repeatable job, and its processor all simply do not exist for the lifetime of the process — the
 * "invisible and inert" guarantee holds structurally, not by a runtime check inside this file.
 *
 * Imports `DocumentsCoreModule` (never the full `DocumentsModule`, which also carries the documents
 * HTTP controller and SSE bridge this feature has no use for) for `DocumentsService` alone —
 * `BillingExportService`'s own dependency, the same "Core, not the whole HTTP module" placement
 * `PaymentsModule`/`BankReconciliationModule`/`ClientPortalModule` already hold, each for the exact
 * same reason (see their own module headers).
 *
 * `MailService` is provided directly here — a leaf, empty-constructor provider (see
 * `document-queue-worker.module.ts`'s own header for why every OTHER module that needs it just lists
 * it in its own `providers` too, rather than relying on `DocumentsCoreModule`'s unexported instance).
 */
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bullmq';

import { redisConnection } from '../documents/queue/redis.config';
import { DocumentsCoreModule } from '../documents/documents-core.module';
import { BillingController } from './billing.controller';
import { BillingLifecycleSweepRunner } from './billing-lifecycle-sweep-runner';
import { BillingCustomerProvisioningBootService } from './customer-provisioning-boot.service';
import { BillingExportService } from './export-zip.service';
import { PolarWebhookController } from './polar-webhook.controller';
import { SeatsController } from './seats.controller';
import { BillingLifecycleProcessor } from './queue/billing-lifecycle.processor';
import {
  BILLING_LIFECYCLE_SWEEP_JOB_ID,
  BILLING_LIFECYCLE_SWEEP_JOB_NAME,
  Q_BILLING_LIFECYCLE,
  readBillingLifecycleSweepIntervalMs,
} from './queue/billing-queue.constants';
import { MailService } from '@/mail/mail.service';

@Module({
  imports: [
    DocumentsCoreModule,
    // Its own `connection` (rather than relying on `DocumentQueueModule`'s own global
    // `BullModule.forRoot()`) so this module stays self-contained — provable/testable on its own,
    // never dependent on import ORDER with the documents module elsewhere in the graph.
    BullModule.forRoot({ connection: redisConnection() }),
    BullModule.registerQueue({ name: Q_BILLING_LIFECYCLE }),
  ],
  controllers: [BillingController, PolarWebhookController, SeatsController],
  providers: [
    MailService,
    BillingExportService,
    BillingLifecycleSweepRunner,
    BillingLifecycleProcessor,
    // `OnModuleInit` — runs the Polar customer-provisioning boot sync (`customer-provisioning.ts`'s own
    // header) once, only in this (API-role) process — see that service's own header.
    BillingCustomerProvisioningBootService,
  ],
})
export class BillingModule implements OnApplicationBootstrap {
  constructor(@InjectQueue(Q_BILLING_LIFECYCLE) private readonly queue: Queue) {}

  /**
   * Registers the ONE repeatable sweep job — idempotent (BullMQ dedups a repeatable definition by its
   * own key across the whole cluster), same `attempts: 1` reasoning every sibling sweep in this
   * codebase already documents: a pass that itself throws is a real bug worth surfacing loudly now,
   * never silently retried moments later — the next tick, `readBillingLifecycleSweepIntervalMs()`
   * away, is already the natural retry. Note `runSweep` itself additionally never lets one bad
   * SUBSCRIPTION sink the whole pass (`billing-lifecycle-sweep-runner.ts`'s own header) — this
   * `attempts: 1` is about the PASS as a whole failing outright (a DB outage reading the initial
   * list), not about one company's own hiccup.
   */
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.add(
      BILLING_LIFECYCLE_SWEEP_JOB_NAME,
      {},
      {
        jobId: BILLING_LIFECYCLE_SWEEP_JOB_ID,
        repeat: { every: readBillingLifecycleSweepIntervalMs() },
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }
}
