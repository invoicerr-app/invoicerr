/**
 * Runs `reconcileMissingCompanyCustomers` (`customer-provisioning.ts`) ONCE at process boot — modeled
 * on `documents/country-policy/boot-reseed.service.ts`'s own `OnModuleInit` shape (same "NEVER throws"
 * choice). Registered in `billing.module.ts`, which is imported ONLY into the API process's
 * `AppModule` and never into `WorkerModule` (see that module's own header) — so this already only ever
 * runs in the `api` role, with no `ROLE` env check of its own needed.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { reconcileMissingCompanyCustomers } from './customer-provisioning';

@Injectable()
export class BillingCustomerProvisioningBootService implements OnModuleInit {
  private readonly logger = new Logger(BillingCustomerProvisioningBootService.name);

  async onModuleInit(): Promise<void> {
    try {
      const summary = await reconcileMissingCompanyCustomers();
      this.logger.log(
        `Polar customer boot sync: ${summary.total} compan${summary.total === 1 ? 'y' : 'ies'} checked, ` +
          `${summary.alreadyExisted} already had a customer, ${summary.created} created, ` +
          `${summary.emailTaken} refused (billing email already taken elsewhere — will retry once fixed), ` +
          `${summary.skipped} skipped (no billing email set — see WARN log per company), ` +
          `${summary.failed} failed (retried on the next boot or lifecycle-sweep tick).`,
      );
    } catch (error) {
      // NEVER throws into boot — same discipline every other boot-reseed service in this codebase holds
      // (`documents/country-policy/boot-reseed.service.ts`'s own header): a Polar outage or a DB hiccup
      // at boot must not crash the whole process. A company left without a customer here is picked up
      // by the next boot, or by the lifecycle sweep (`billing-lifecycle-sweep-runner.ts` also calls
      // `reconcileMissingCompanyCustomers` every tick — see that function's own header).
      this.logger.error('Polar customer boot sync failed outright — will retry on the next boot', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
