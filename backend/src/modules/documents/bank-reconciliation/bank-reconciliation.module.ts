import { Module } from '@nestjs/common';

import { DocumentsCoreModule } from '../documents-core.module';
import { BankReconciliationController } from './bank-reconciliation.controller';
import { BankReconciliationService } from './bank-reconciliation.service';

/**
 * Imports `DocumentsCoreModule` for exactly ONE reason: `BankReconciliationService.reconcileLine`
 * injects `DocumentsService` to call `runAction('invoice', 'record-payment', ...)` — the SAME action a
 * hand-entered payment goes through — rather than writing a second path to `DocumentPayment` (see that
 * service's own header for why two write paths to the same table would drift). Every OTHER read this
 * feature does (candidate invoices, the CSV/OFX parsers, the statement/line persistence) reaches
 * Prisma directly through plain functions needing no DI at all — the same "no DI needed for a pure
 * read" shape `accounting-export/accounting-export.module.ts` already holds; `DocumentsCoreModule` is
 * imported SOLELY to make `DocumentsService` injectable here, never for its many other providers.
 *
 * Registered directly in `AppModule`, alongside (not inside) `DocumentsModule` — the same
 * "type-adjacent, standalone module" placement `ReceivedInvoicesModule`/`AccountingExportModule`
 * already have; this feature is not a `DocumentTypeDescriptor` and has no business inside the generic
 * document controller either.
 */
@Module({
  imports: [DocumentsCoreModule],
  controllers: [BankReconciliationController],
  providers: [BankReconciliationService],
})
export class BankReconciliationModule {}
