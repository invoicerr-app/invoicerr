import { Module } from '@nestjs/common';

import { DocumentsCoreModule } from '../documents-core.module';
import { PaymentMethodsController } from './payment-methods.controller';
import { PaymentMethodsService } from './payment-methods.service';

/**
 * The HTTP half of payment-methods/ — registered directly in `AppModule`, alongside (not inside)
 * `DocumentsModule`, the same "type-adjacent, standalone module" placement `PaymentsModule`/
 * `BankReconciliationModule`/`ClientPortalModule` already have: a payment method is a company-level
 * setting, not a `DocumentTypeDescriptor`, and has no business inside the generic document controller.
 * Imports `DocumentsCoreModule` only for the module-loading convention every sibling here follows —
 * `PaymentMethodsService` itself needs nothing from it (see that class's own header): every actual
 * dependency (`defaultPaymentMethodRegistry`, `prisma`) is a plain, directly-imported singleton, not a
 * DI token this module would need to source.
 */
@Module({
  imports: [DocumentsCoreModule],
  controllers: [PaymentMethodsController],
  providers: [PaymentMethodsService],
})
export class PaymentMethodsModule {}
