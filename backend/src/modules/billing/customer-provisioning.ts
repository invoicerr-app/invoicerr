/**
 * Makes sure EVERY company has its own Polar customer (option A, product decision 2026-09-16: one
 * customer PER COMPANY, `external_id = company.id` — `billing-customer.ts`'s own header) — proactively,
 * not lazily on first checkout the way `getOrCreatePolarCustomerForCompany` alone works. Added
 * 2026-09-16 after a concrete dev-instance incident: a company reconciled to `ACTIVE` from a
 * PRE-migration per-user customer (`legacy-customer.ts`) still had no company-scoped customer of its
 * OWN, and `GET /api/billing/status` had no proactive path to create one — only a checkout attempt did.
 *
 * Called from TWO places: `BillingCustomerProvisioningBootService` (this file's own sibling) runs it
 * ONCE at boot, for every API-role process (`BillingModule` is only ever imported into the API
 * process's `AppModule`, never `WorkerModule` — see that module's own header — so this never needs its
 * own `ROLE` check); `BillingLifecycleSweepRunner#runSweep` also calls it every tick, so a company
 * created (or whose creation attempt failed, e.g. a since-fixed `billingEmail`) AFTER boot is still
 * picked up without waiting for a restart — the product ask this file was written for explicitly wants
 * that ("no Polar customer" should end up meaning only the still-unfixed email-taken case).
 *
 * Idempotent, per company: `customers.getExternal({ externalId: companyId })` is always checked FIRST
 * — a company that already has one (created here on an earlier pass, at checkout, or manually) is
 * counted as `alreadyExisted` and never re-created. Never throws for a SINGLE company's failure — the
 * same "one bad row must not sink the whole pass" discipline every sweep in this codebase already holds
 * (`billing-lifecycle-sweep-runner.ts`'s own header) — a company left without a customer here is
 * retried on the NEXT boot or sweep tick, except the one genuinely un-retryable case: a duplicate
 * billing email (`BillingEmailTakenError`), which needs a human to set a distinct
 * `Company.billingEmail` (Settings > Billing) and is logged by name, not retried blindly forever.
 *
 * Every Polar call goes through `callPolarWithRetry` — the one choke point every automatic (never
 * user-initiated) Polar call in this module family shares (`polar-client.ts`'s own header) — bounded
 * exponential backoff on a 429, so scanning every company at boot cannot itself trip Polar's own rate
 * limiter into a hard failure.
 */
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

import {
  BillingCustomerClient,
  BillingEmailTakenError,
  getOrCreatePolarCustomerForCompany,
  isResourceNotFoundError,
} from './billing-customer';
import { callPolarWithRetry, getPolarClient } from './polar-client';

export interface ReconcileMissingCompanyCustomersSummary {
  total: number;
  /** Already had a company-scoped Polar customer — nothing to do. */
  alreadyExisted: number;
  /** Created a fresh company-scoped Polar customer this pass. */
  created: number;
  /** Refused by Polar (422, duplicate billing email) — left without a customer on purpose; see this
   *  file's own header. Logged by name, `Company.billingEmail` is the fix. */
  emailTaken: number;
  /** Any other failure (existence check or creation) — logged, left for the next boot/sweep pass. */
  failed: number;
}

/** `false` (never throws) on anything other than "no customer registered at all" — the caller treats
 *  that as `failed`, not as `false` meaning "definitely missing", so a transient outage never causes a
 *  duplicate-creation attempt to race a customer that may already exist. */
async function checkCustomerExists(
  companyId: string,
  client: BillingCustomerClient,
): Promise<boolean | 'error'> {
  try {
    await callPolarWithRetry(
      () => client.customers.getExternal({ externalId: companyId }),
      `customer provisioning: customers.getExternal for company ${companyId}`,
    );
    return true;
  } catch (error) {
    if (isResourceNotFoundError(error)) return false;
    logger.warn('Polar customer existence check failed during provisioning — retried next pass', {
      category: 'billing',
      details: { companyId, error: error instanceof Error ? error.message : String(error) },
    });
    return 'error';
  }
}

/**
 * Walks every `Company` row and makes sure each one has its own Polar customer, creating one where
 * missing. Returns a summary this file's boot service (and, once wired, the lifecycle sweep) logs —
 * see this file's own header for the exact counts' meaning.
 */
export async function reconcileMissingCompanyCustomers(
  client: BillingCustomerClient = getPolarClient() as unknown as BillingCustomerClient,
): Promise<ReconcileMissingCompanyCustomersSummary> {
  const companies = await prisma.company.findMany({
    select: { id: true, name: true, email: true, billingEmail: true },
  });

  const summary: ReconcileMissingCompanyCustomersSummary = {
    total: companies.length,
    alreadyExisted: 0,
    created: 0,
    emailTaken: 0,
    failed: 0,
  };

  for (const company of companies) {
    const exists = await checkCustomerExists(company.id, client);
    if (exists === 'error') {
      summary.failed++;
      continue;
    }
    if (exists) {
      summary.alreadyExisted++;
      continue;
    }

    try {
      // Re-checks existence internally (one more `getExternal`, now known to 404) before creating —
      // accepted redundancy for a boot-time-or-sweep-tick pass, never a hot path: reusing this already
      // email-taken-aware, already-tested function beats duplicating its 422 handling here.
      await callPolarWithRetry(
        () => getOrCreatePolarCustomerForCompany(company, client),
        `customer provisioning: create Polar customer for company ${company.id}`,
      );
      summary.created++;
    } catch (error) {
      if (error instanceof BillingEmailTakenError) {
        summary.emailTaken++;
        logger.warn(
          'Polar customer provisioning refused: billing email already used by another Polar customer. ' +
            'Company left without a Polar customer — set a distinct Company.billingEmail ' +
            '(Settings > Billing) and it will be picked up on the next pass.',
          { category: 'billing', details: { companyId: company.id, email: error.email } },
        );
        continue;
      }
      summary.failed++;
      logger.warn('Polar customer provisioning failed for one company — retried next pass', {
        category: 'billing',
        details: { companyId: company.id, error: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  return summary;
}
