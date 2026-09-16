/**
 * Keeps a company's Polar customer's `name`/`email` in sync with the company's own — triggered by
 * `company.service.ts#editCompanyInfo` the moment a rename or a billing-email-affecting edit actually
 * lands, and retried by `billing-lifecycle-sweep-runner.ts` on every tick for any subscription whose
 * LAST attempt failed (`CompanySubscription.customerSyncFailedAt`, `schema.prisma`'s own comment).
 *
 * Never throws into its caller — the SAME "a Polar outage must not turn an application write into a
 * 500" discipline `seat-sync.ts`/`member-sync.ts` already hold: `company.service.ts#editCompanyInfo`
 * must succeed (the company's OWN data IS the source of truth) even when Polar is unreachable at that
 * exact moment. A failure is logged and stamps `customerSyncFailedAt` so the sweep can retry it
 * without the caller having to remember to.
 */
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

import { isResourceNotFoundError } from './billing-customer';
import { isBillingEnabled } from './billing-flag';
import { getPolarClient } from './polar-client';

/** Narrow, mockable subset of the `Polar` SDK client this module calls — same convention every other
 *  billing file narrows its own client shape to. `CustomerUpdateExternalID` (`@polar-sh/sdk`, read
 *  directly) only accepts `name`/`email` (plus fields this module never writes) — exactly the two
 *  facts a company rename/email change actually changes. */
export interface CustomerSyncClient {
  customers: {
    updateExternal(request: {
      externalId: string;
      customerUpdateExternalID: { name?: string | null; email?: string | null };
    }): Promise<unknown>;
  };
}

/** The fields this module needs from a `Company` row — the same narrow-projection convention
 *  `CompanyBillingIdentity` (`billing-customer.ts`) already holds, so a caller/spec never needs a full
 *  Prisma row. */
export interface CompanyCustomerFacts {
  name: string;
  email: string;
  billingEmail: string | null;
}

/**
 * Pushes this company's current `name`/resolved billing email to its Polar customer. A NO-OP (never
 * even attempts the call) when billing is disabled, or when this company has no Polar customer yet at
 * all (`isResourceNotFoundError` — a TRIAL company that never checked out; its FIRST checkout will
 * create the customer with today's data already, so there is nothing to "sync" onto yet).
 */
export async function syncPolarCustomerOnCompanyChange(
  companyId: string,
  company: CompanyCustomerFacts,
  client: CustomerSyncClient = getPolarClient() as unknown as CustomerSyncClient,
): Promise<void> {
  if (!isBillingEnabled()) return;

  // Same precedence as checkout (`billing-customer.ts#resolveBillingEmail`, duplicated here rather
  // than imported — that function's own type is keyed to the checkout-specific `CompanyBillingIdentity`
  // shape, which carries an `id` this module has no use for).
  const email = company.billingEmail?.trim() || company.email;

  try {
    await client.customers.updateExternal({
      externalId: companyId,
      customerUpdateExternalID: { name: company.name, email },
    });

    // Clears a PRIOR failure — this push just succeeded, so the sweep no longer needs to retry it.
    // `updateMany` (not `update`) because this can run for a company whose `CompanySubscription` row
    // does not exist yet (billing enabled mid-session for a company nobody has touched since) —
    // exactly the same defensive shape the rest of this module family avoids assuming a row exists.
    await prisma.companySubscription.updateMany({
      where: { companyId, customerSyncFailedAt: { not: null } },
      data: { customerSyncFailedAt: null },
    });
  } catch (error) {
    if (isResourceNotFoundError(error)) return; // no Polar customer yet — nothing to push onto.

    logger.warn('Polar customer sync failed — will retry from the lifecycle sweep', {
      category: 'billing',
      details: { companyId, error: error instanceof Error ? error.message : String(error) },
    });
    await prisma.companySubscription
      .updateMany({ where: { companyId }, data: { customerSyncFailedAt: new Date() } })
      .catch(() => undefined);
  }
}
