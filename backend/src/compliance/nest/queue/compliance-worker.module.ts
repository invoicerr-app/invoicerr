import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { ComplianceCoreModule } from '../compliance-core.module';
import { PingProcessor } from './processors/ping.processor';
import { PollProcessor } from './processors/poll.processor';
import { TransmitProcessor } from './processors/transmit.processor';
import { Q_PING } from './queue.constants';

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
 * PHASE 2 (QUEUE_IMPL_PLAN.md §9): adds the real `TransmitProcessor`/`PollProcessor`, wired against
 * `ComplianceCoreModule` — the providers-only compliance module (no controllers, no
 * `ComplianceCron`/`@Interval` — see its docstring) so the worker process instantiates the exact
 * same DI-wired, CREDENTIALED (F-3) `TransmissionProviderRegistry`/`ApplySignalService`/Prisma
 * stores as the API process, without also starting a second in-process cron or requiring
 * `ScheduleModule` (which the worker never imports). The Phase 1 `PingProcessor` + its own queue
 * (`compliance-ping`, registered locally here, NOT part of `QueueModule`) are KEPT as an
 * infra-only regression guard for the API/worker split (see queue-smoke.redis.spec.ts) —
 * independent of whether the real compliance processors wire up correctly.
 */
@Module({
  imports: [BullModule.registerQueue({ name: Q_PING }), ComplianceCoreModule],
  providers: [PingProcessor, TransmitProcessor, PollProcessor],
  exports: [BullModule],
})
export class ComplianceWorkerModule {}
