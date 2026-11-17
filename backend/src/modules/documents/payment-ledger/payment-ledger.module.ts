import { Module } from '@nestjs/common';

import { PaymentLedgerController } from './payment-ledger.controller';
import { PaymentLedgerService } from './payment-ledger.service';

/** Its own module, like `revenue-report.module.ts`: the ledger reads the `prisma` singleton and the
 *  country catalog directly and needs nothing from `DocumentsCoreModule`'s provider graph. */
@Module({
  controllers: [PaymentLedgerController],
  providers: [PaymentLedgerService],
})
export class PaymentLedgerModule {}
