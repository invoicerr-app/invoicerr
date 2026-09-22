import { Module } from '@nestjs/common';

import { DocumentsCoreModule } from '../documents-core.module';
import { PaymentsController } from './payments.controller';
import { PaymentsWebhookController } from './payments-webhook.controller';

/**
 * Online payment ("paiement en ligne") — the HTTP half. `PaymentSessionsService` itself is a
 * provider OF `DocumentsCoreModule` (next to `ShareLinksService`/`SignaturesService`, for the identical
 * reason that module's own header gives for those two: "so a DIRECT consumer of `DocumentsCoreModule`
 * can inject it too" — here, TWO consumers do, this module's own `PaymentsController`/
 * `PaymentsWebhookController` AND `ClientPortalModule`'s `PortalService`, which already imports
 * `DocumentsCoreModule` for other reasons and gets this one for free).
 *
 * Registered directly in `AppModule`, alongside (not inside) `DocumentsModule` — the same
 * "type-adjacent, standalone module" placement `BankReconciliationModule`/`ClientPortalModule` already
 * have; a checkout session is not a `DocumentTypeDescriptor` and has no business inside the generic
 * document controller either.
 */
@Module({
  imports: [DocumentsCoreModule],
  controllers: [PaymentsController, PaymentsWebhookController],
})
export class PaymentsModule {}
