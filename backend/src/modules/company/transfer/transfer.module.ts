/**
 * The HTTP half of company ownership transfer: an OWNER hands the role to another account, PENDING
 * until the recipient accepts, expiring after 7 days via a repeatable sweep. Imported
 * unconditionally, unlike billing, because the feature also works self-hosted.
 *
 * The queue wiring and providers live in `transfer-core.module.ts`.
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
