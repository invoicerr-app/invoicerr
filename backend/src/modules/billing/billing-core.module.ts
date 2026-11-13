/**
 * Providers-only half of billing's queue, so a `ROLE=worker` process can consume
 * `Q_BILLING_LIFECYCLE` without pulling in the HTTP controllers. `exports: [BullModule]` lets the
 * consuming module resolve the connection registered under `BILLING_BULL_CONFIG_KEY`.
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
