import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';

import { ComplianceQueueDispatcher } from './compliance-queue.dispatcher';
import { Q_POLL, Q_REPORT, Q_SWEEP, Q_TIMER, Q_TRANSMIT } from './queue.constants';
import { redisConnection } from './redis.config';

/**
 * Global BullMQ wiring for the compliance async status loop (QUEUE_IMPL_PLAN.md §4.3).
 *
 * `@Global()` so that `@InjectQueue(...)` and `ComplianceQueueDispatcher` are available
 * anywhere in the app (API controllers/services to *enqueue*, worker processors to
 * *consume*) without every module re-importing this one. Registers the connection once
 * (`BullModule.forRoot`, itself global — see @nestjs/bullmq internals) plus the 4 target
 * queues (transmit/poll/timer/report) and the sweep repeatable queue.
 *
 * NOTE: the Phase-1-only demo queue (`compliance-ping`) is intentionally NOT registered
 * here — it lives with its own processor in compliance-worker.module.ts and is removed
 * once a real processor exists.
 */
@Global()
@Module({
  imports: [
    BullModule.forRoot({ connection: redisConnection() }),
    BullModule.registerQueue(
      { name: Q_TRANSMIT },
      { name: Q_POLL },
      { name: Q_TIMER },
      { name: Q_REPORT },
      { name: Q_SWEEP },
    ),
  ],
  providers: [ComplianceQueueDispatcher],
  exports: [BullModule, ComplianceQueueDispatcher],
})
export class QueueModule {}
