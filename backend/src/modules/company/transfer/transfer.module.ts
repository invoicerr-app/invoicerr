/**
 * Company ownership transfer (product decision 2026-09-17): an OWNER hands the OWNER role to another
 * user's account (`toEmail`, free-typed, never an autocomplete over members); PENDING until the
 * recipient explicitly accepts, expiring after 7 days via a BullMQ repeatable sweep — never a Nest
 * cron, per this repo's own "Working with the owner" convention every other sweep already follows.
 *
 * Always imported (`app.module.ts`, unconditionally, alongside `InvitationsModule`/`LegalModule`) —
 * unlike `BillingModule`, this feature works in self-hosted mode too (`transfer.service.ts`'s own
 * subscription gate is itself a no-op there, see `isBillingEnabled()`).
 *
 * SPLIT from the queue's own providers/consumer (`transfer-core.module.ts`/
 * `transfer-queue-worker.module.ts`): this module used to ALSO carry `BullModule.forRoot`/
 * `registerQueue`, `TransferExpirySweepRunner` and `TransferExpiryProcessor` directly, and being
 * imported ONLY by `AppModule` (never `worker.module.ts`) meant the expiry sweep always ran on an API
 * replica — see `transfer-core.module.ts`'s own header for the full account. This is now the HTTP-only
 * half; the queue wiring lives there instead.
 *
 * `MailService` is provided directly here too (plain, empty-constructor leaf provider) — `TransferService`'s
 * own dependency, the same "every module that needs it just lists it in its own providers" convention
 * `billing.module.ts`/`danger.module.ts`/`documents-core.module.ts` each independently document.
 */
import { Module } from '@nestjs/common';

import { MailService } from '@/mail/mail.service';

import { AccountTransfersController } from './account-transfers.controller';
import { TransferController } from './transfer.controller';
import { TransferCoreModule } from './transfer-core.module';
import { TransferService } from './transfer.service';

@Module({
  imports: [TransferCoreModule],
  controllers: [TransferController, AccountTransfersController],
  providers: [MailService, TransferService],
})
export class TransferModule {}
