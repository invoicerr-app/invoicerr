import { Module } from '@nestjs/common';

import { ReceivedInvoicesController } from './received-invoices.controller';
import { ReceivedInvoicesService } from './received-invoices.service';

/**
 * Root TODO item 18's own small module — imports nothing from `DocumentsCoreModule` (its service
 * reaches Prisma only through `persistence.ts`'s free functions, exactly like every action handler
 * in `actions/` already does, never through an injected repository), so there is no risk of the
 * circular-import shape `documents.module.ts`'s own header warns about elsewhere in this codebase.
 * Registered directly in `AppModule`, alongside (not inside) `DocumentsModule` — the same
 * "type-adjacent, standalone module" placement `modules/company/signing-certificates/` already has.
 */
@Module({
  controllers: [ReceivedInvoicesController],
  providers: [ReceivedInvoicesService],
})
export class ReceivedInvoicesModule {}
