import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { ComplianceWorkerModule } from './compliance/nest/queue/compliance-worker.module';
import { QueueModule } from './compliance/nest/queue/queue.module';
import { PrismaModule } from './prisma/prisma.module';

/**
 * Root module for the dedicated worker process (bootstrapped by worker.ts).
 *
 * Deliberately minimal: no controllers, no auth guards, none of the invoices/quotes/etc.
 * feature modules — only what the queue processors need (ConfigModule for env access,
 * PrismaModule for DB access, QueueModule for the BullMQ connection + dispatcher,
 * ComplianceWorkerModule for the processors themselves). See QUEUE_IMPL_PLAN.md §4.8.
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, QueueModule, ComplianceWorkerModule],
})
export class WorkerModule {}
