import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { PingProcessor } from './processors/ping.processor';
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
 * PHASE 1: contains only the disposable demo `PingProcessor` (see processors/ping.processor.ts)
 * to prove the split without wiring any compliance business logic. Real processors
 * (transmit/poll/timer/report/sweep) + the compliance provider registries land in a later
 * phase and will replace/extend the providers here.
 */
@Module({
  imports: [BullModule.registerQueue({ name: Q_PING })],
  providers: [PingProcessor],
  exports: [BullModule],
})
export class ComplianceWorkerModule {}
