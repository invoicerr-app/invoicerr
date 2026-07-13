import { BullModule } from '@nestjs/bullmq';
import { Module, OnApplicationBootstrap } from '@nestjs/common';

import { ComplianceCoreModule } from '../compliance-core.module';
import { ComplianceQueueDispatcher } from './compliance-queue.dispatcher';
import { PingProcessor } from './processors/ping.processor';
import { PollProcessor } from './processors/poll.processor';
import { ReportProcessor } from './processors/report.processor';
import { SweepProcessor } from './processors/sweep.processor';
import { TimerProcessor } from './processors/timer.processor';
import { TransmitProcessor } from './processors/transmit.processor';
import { Q_PING } from './queue.constants';
import { QueueModule } from './queue.module';

/**
 * Gate target for WORKER_INLINE (QUEUE_IMPL_PLAN.md §5.5 / Décision 4).
 *
 * `WorkerModule` (dedicated worker process, worker.ts) ALWAYS imports this module.
 * `AppModule` (API process) imports it only when `WORKER_INLINE !== 'false'` (default:
 * inline/mono). NestJS only instantiates `@Processor()` classes that are reachable from an
 * imported module, so gating this import is sufficient to gate consumption — no double
 * processing, since in giga (multi-instance) deployments the API sets WORKER_INLINE=false
 * and only the dedicated worker process(es) import this module.
 *
 * PHASE 2 (QUEUE_IMPL_PLAN.md §9): added the real `TransmitProcessor`/`PollProcessor`, wired against
 * `ComplianceCoreModule` — the providers-only compliance module (no controllers) so the worker
 * process instantiates the exact same DI-wired, CREDENTIALED (F-3)
 * `TransmissionProviderRegistry`/`ApplySignalService`/Prisma stores as the API process. The Phase 1
 * `PingProcessor` + its own queue (`compliance-ping`, registered locally here, NOT part of
 * `QueueModule`) are KEPT as an infra-only regression guard for the API/worker split (see
 * queue-smoke.redis.spec.ts) — independent of whether the real compliance processors wire up
 * correctly.
 *
 * PHASE 3 (QUEUE_IMPL_PLAN.md §9): adds `TimerProcessor`/`ReportProcessor`/`SweepProcessor` — these
 * replace `ComplianceCron` (`@Interval`/`@Cron` + `CronLockService`, both deleted this phase) now
 * that BullMQ repeatables/dedup-by-jobId make the distributed lock unnecessary. `SweepProcessor`
 * also needs `InboxPoller`, which moved from `ComplianceModule` into `ComplianceCoreModule` in this
 * phase so it's reachable here too (see compliance-core.module.ts's docstring).
 *
 * `onApplicationBootstrap` registers the repeatable `compliance-report`/`compliance-sweep` jobs —
 * this runs wherever `ComplianceWorkerModule` is actually loaded (the dedicated worker process
 * always; the API process only when WORKER_INLINE!=='false'), i.e. exactly the processes that will
 * consume them. Safe to call from multiple booting instances: BullMQ dedups a repeat definition by
 * its repeat key across the whole cluster (Décision 3/5).
 */
@Module({
  imports: [BullModule.registerQueue({ name: Q_PING }), QueueModule, ComplianceCoreModule],
  providers: [
    PingProcessor,
    TransmitProcessor,
    PollProcessor,
    TimerProcessor,
    ReportProcessor,
    SweepProcessor,
  ],
  exports: [BullModule],
})
export class ComplianceWorkerModule implements OnApplicationBootstrap {
  constructor(private readonly dispatcher: ComplianceQueueDispatcher) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.dispatcher.registerRepeatables();
  }
}
