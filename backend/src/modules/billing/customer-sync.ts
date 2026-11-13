/**
 * Never throws into its caller: a company edit must succeed even when Polar is unreachable. Failures
 * stamp `customerSyncFailedAt` so the lifecycle sweep retries them.
 */
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

import { isResourceNotFoundError } from './billing-customer';
import { isBillingEnabled } from './billing-flag';
import { getPolarClient } from './polar-client';

/** Narrow, mockable subset of the Polar SDK client this module calls. */
export interface CustomerSyncClient {
  customers: {
    updateExternal(
      externalId: string,
      body: { name?: string | null; email?: string | null },
    ): Promise<unknown>;
  };
}

export interface CompanyCustomerFacts {
  name: string;
  email: string;
  billingEmail: string | null;
}

/**
 * No-op when billing is disabled or the company has no Polar customer yet: its first checkout will
 * create the customer with current data.
 */
export async function syncPolarCustomerOnCompanyChange(
  companyId: string,
  company: CompanyCustomerFacts,
  client: CustomerSyncClient = getPolarClient() as unknown as CustomerSyncClient,
): Promise<void> {
  if (!isBillingEnabled()) return;

  // Same precedence as `resolveBillingEmail`, duplicated because that one takes a shape with an `id`.
  const email = company.billingEmail?.trim() || company.email;

  // Not stamped as a failure: a missing email is a data problem that a sweep retry cannot fix.
  if (!email) return;

  try {
    await client.customers.updateExternal(companyId, { name: company.name, email });

    // `updateMany`, not `update`: the `CompanySubscription` row may not exist yet.
    await prisma.companySubscription.updateMany({
      where: { companyId, customerSyncFailedAt: { not: null } },
      data: { customerSyncFailedAt: null },
    });
  } catch (error) {
    if (isResourceNotFoundError(error)) return; // no Polar customer yet

    logger.warn('Polar customer sync failed, will retry from the lifecycle sweep', {
      category: 'billing',
      companyId,
      details: { companyId, error: error instanceof Error ? error.message : String(error) },
    });
    await prisma.companySubscription
      .updateMany({ where: { companyId }, data: { customerSyncFailedAt: new Date() } })
      .catch(() => undefined);
  }
}
