import { Module } from '@nestjs/common';

import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { ReceivedInvoicesController } from './received-invoices.controller';
import { ReceivedInvoicesService } from './received-invoices.service';

/**
 * A small module — imports nothing from `DocumentsCoreModule` (its service
 * reaches Prisma only through `persistence.ts`'s free functions, exactly like every action handler
 * in `actions/` already does, never through an injected repository), so there is no risk of the
 * circular-import shape `documents.module.ts`'s own header warns about elsewhere in this codebase.
 * Registered directly in `AppModule`, alongside (not inside) `DocumentsModule` — the same
 * "type-adjacent, standalone module" placement `modules/company/signing-certificates/` already has.
 *
 * `ReconciliationService` — purchase orders & goods receipts, second pass (three-way match /
 * rapprochement à 3 voies) — is registered here rather than in
 * `DocumentsCoreModule`: it, too, reaches Prisma only through `persistence.ts`'s free functions and
 * the bare `prisma` singleton (`reconciliation-settings.ts`, `variance-acceptance.ts`'s own imports),
 * so it needs nothing from the Core module either — the identical reasoning `ReceivedInvoicesService`
 * itself already holds.
 */
@Module({
  controllers: [ReceivedInvoicesController],
  providers: [ReceivedInvoicesService, ReconciliationService],
})
export class ReceivedInvoicesModule {}
