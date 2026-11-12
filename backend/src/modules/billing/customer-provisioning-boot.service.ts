/**
 * Runs `reconcileMissingCompanyCustomers` once at boot. `billing.module.ts` is only imported by the API
 * process, so this never runs in the worker and needs no `ROLE` check.
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
      // Never throw into boot: a company left without a customer is retried next boot or by the lifecycle sweep.
      this.logger.error('Polar customer boot sync failed outright — will retry on the next boot', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
