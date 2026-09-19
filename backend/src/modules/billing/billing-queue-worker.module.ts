import { InjectQueue } from '@nestjs/bullmq';
import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bullmq';

import { BillingCoreModule } from './billing-core.module';
import { BillingLifecycleProcessor } from './queue/billing-lifecycle.processor';
import {
  BILLING_LIFECYCLE_SWEEP_JOB_ID,
  BILLING_LIFECYCLE_SWEEP_JOB_NAME,
  Q_BILLING_LIFECYCLE,
  readBillingLifecycleSweepIntervalMs,
} from './queue/billing-queue.constants';

/**
 * The CONSUMING half of the billing-lifecycle queue — the gate target for `WORKER_INLINE`
 * (default `true`), the exact same split `app.module.ts`'s own comment on
 * `DocumentsQueueWorkerModule` documents for the documents queue: `WorkerModule` (`ROLE=worker`)
 * ALWAYS imports this (gated only on `isBillingEnabled()` — a worker with no billing configured has
 * nothing to consume either); `AppModule` imports it only when `WORKER_INLINE !== 'false'` AND billing
 * is enabled. Nest only instantiates `@Processor()` classes reachable from an imported module, so
 * gating THIS import is enough to gate consumption entirely — a job is never consumed twice.
 *
 * Imports `BillingCoreModule` (never `BillingModule`, which also carries the HTTP controllers and the
 * API-only customer-provisioning boot step this worker process has no use for) so
 * `BillingLifecycleProcessor` gets the SAME DI-wired `BillingLifecycleSweepRunner` (and therefore the
 * same `BillingExportService`/`DocumentsService`) the API process would have used inline — never a
 * second, parallel construction of them.
 *
 * `onApplicationBootstrap` registers the ONE repeatable sweep job here (moved from `billing.module.ts`
 * — see that file's own header) — idempotent (BullMQ dedups a repeatable definition by its own key
 * across the whole cluster), so calling this on EVERY process that imports this module (the API
 * in-line, or every dedicated worker replica) is safe, never a double registration. `attempts: 1`,
 * same reasoning every sibling sweep in this codebase documents: a pass that itself throws is a real
 * bug worth surfacing loudly now, never silently retried moments later — the next tick,
 * `readBillingLifecycleSweepIntervalMs()` away, is already the natural retry.
 */
@Module({
  imports: [BillingCoreModule],
  providers: [BillingLifecycleProcessor],
})
export class BillingQueueWorkerModule implements OnApplicationBootstrap {
  constructor(@InjectQueue(Q_BILLING_LIFECYCLE) private readonly queue: Queue) {}

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
