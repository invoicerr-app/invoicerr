/**
 * Company ownership transfer (product decision 2026-09-17): an OWNER hands the OWNER role to another
 * user's account (`toEmail`, free-typed, never an autocomplete over members); PENDING until the
 * recipient explicitly accepts, expiring after 7 days via a BullMQ repeatable sweep — never a Nest
 * cron, per this repo's own "Working with the owner" convention every other sweep already follows.
 *
 * Always imported (`app.module.ts`, unconditionally, alongside `InvitationsModule`/`LegalModule`) —
 * unlike `BillingModule`, this feature works in self-hosted mode too (`transfer.service.ts`'s own
 * subscription gate is itself a no-op there, see `isBillingEnabled()`). Own dedicated BullMQ queue
 * (`queue/transfer-queue.constants.ts`) rather than joining the documents module's — see that file's
 * own header for why.
 *
 * `MailService` is provided directly here (plain, empty-constructor leaf provider) — the same "every
 * module that needs it just lists it in its own providers" convention `billing.module.ts`/
 * `danger.module.ts`/`documents-core.module.ts` each independently document.
 */
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bullmq';

import { MailService } from '@/mail/mail.service';

import { redisConnection } from '../../documents/queue/redis.config';
import { AccountTransfersController } from './account-transfers.controller';
import { TransferExpiryProcessor } from './queue/transfer-expiry.processor';
import {
  Q_COMPANY_TRANSFER,
  readTransferExpirySweepIntervalMs,
  TRANSFER_BULL_CONFIG_KEY,
  TRANSFER_EXPIRY_SWEEP_JOB_ID,
  TRANSFER_EXPIRY_SWEEP_JOB_NAME,
} from './queue/transfer-queue.constants';
import { TransferController } from './transfer.controller';
import { TransferExpirySweepRunner } from './transfer-expiry-sweep-runner';
import { TransferService } from './transfer.service';

@Module({
  imports: [
    BullModule.forRoot(TRANSFER_BULL_CONFIG_KEY, { connection: redisConnection() }),
    BullModule.registerQueue({ configKey: TRANSFER_BULL_CONFIG_KEY, name: Q_COMPANY_TRANSFER }),
  ],
  controllers: [TransferController, AccountTransfersController],
  providers: [MailService, TransferService, TransferExpirySweepRunner, TransferExpiryProcessor],
})
export class TransferModule implements OnApplicationBootstrap {
  constructor(@InjectQueue(Q_COMPANY_TRANSFER) private readonly queue: Queue) {}

  /** Idempotent registration — BullMQ dedups a repeatable definition by its own key across the whole
   *  cluster, same `attempts: 1` reasoning every sibling sweep in this codebase documents: a pass that
   *  itself throws is a real bug worth surfacing loudly now, not silently retried moments later — the
   *  next tick, `readTransferExpirySweepIntervalMs()` away, is already the natural retry. */
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.add(
      TRANSFER_EXPIRY_SWEEP_JOB_NAME,
      {},
      {
        jobId: TRANSFER_EXPIRY_SWEEP_JOB_ID,
        repeat: { every: readTransferExpirySweepIntervalMs() },
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }
}
