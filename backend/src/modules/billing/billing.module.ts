/**
 * HTTP half of hosted billing, imported by `app.module.ts` only when the billing flag is on, so with
 * the flag off its routes do not exist at all.
 */
import { Module } from '@nestjs/common';

import { BillingCoreModule } from './billing-core.module';
import { BillingController } from './billing.controller';
import { BillingCustomerProvisioningBootService } from './customer-provisioning-boot.service';
import { PolarWebhookController } from './polar-webhook.controller';
import { SeatsController } from './seats.controller';

@Module({
  imports: [BillingCoreModule],
  controllers: [BillingController, PolarWebhookController, SeatsController],
  providers: [
    // Kept here, not in `BillingCoreModule` (also imported by the worker), so its boot sync runs only
    // in the API role.
    BillingCustomerProvisioningBootService,
  ],
})
export class BillingModule {}
