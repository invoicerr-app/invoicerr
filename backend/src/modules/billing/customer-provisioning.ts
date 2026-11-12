/**
 * Proactively gives every company its own Polar customer instead of waiting for its first checkout.
 * Runs once at boot (API process only) and on every lifecycle sweep tick.
 *
 * Idempotent: existence is checked first. One company's failure never sinks the pass; it is retried
 * next pass, except a duplicate billing email, which needs a human to set `Company.billingEmail`.
 *
 * Only companies without a recorded `polarCustomerId` are scanned, and the id is persisted once
 * resolved, so provisioned companies drop out of the query instead of costing a Polar call every tick.
 */
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

import { Prisma } from '../../../prisma/generated/prisma/client';
import {
  BillingCustomerClient,
  BillingEmailTakenError,
  getOrCreatePolarCustomerForCompany,
  isResourceNotFoundError,
  resolveBillingEmail,
} from './billing-customer';
import { recordPolarCustomerId } from './company-subscription.store';
import { invalidateCompanyCustomerFactsCache } from './legacy-customer';
import { MemberResolutionClient } from './member-resolution';
import { ensureCompanyBillingMember } from './member-sync';
import { callPolarWithRetry, getPolarClient } from './polar-client';

/** Bounds memory per round-trip when a large backlog of unprovisioned companies exists. */
export const CUSTOMER_PROVISIONING_BATCH_SIZE = 500;

export interface ReconcileMissingCompanyCustomersSummary {
  total: number;
  alreadyExisted: number;
  created: number;
  /** Duplicate billing email at Polar; needs a distinct `Company.billingEmail`. */
  emailTaken: number;
  /** No email at all: a data problem, not a transient failure, so it gets its own warning. Self-heals
   *  once an email is set, since both fields are re-read every pass. */
  skipped: number;
  failed: number;
}

/** Reads only `statusCode`/`message`, never headers; network errors carry no `statusCode`. */
function extractPolarErrorDetails(error: unknown): { statusCode: number | 'unknown'; message: string } {
  const statusCode =
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    typeof (error as { statusCode: unknown }).statusCode === 'number'
      ? (error as { statusCode: number }).statusCode
      : 'unknown';
  return { statusCode, message: error instanceof Error ? error.message : String(error) };
}

/**
 * The logger prints only the message to stdout; `details` goes to the `Log` table alone, so the cause
 * must be in the message for pod logs to show it. Also used for DB errors (status reads `unknown`).
 */
function formatErrorForLog(error: unknown): string {
  const { statusCode, message } = extractPolarErrorDetails(error);
  return `status ${statusCode}: ${message}`;
}

/** `false` only for a definite 404; any other failure is `'error'`, so an outage never triggers a
 *  duplicate create. */
async function checkCustomerExists(
  companyId: string,
  client: BillingCustomerClient,
): Promise<{ id: string; type: string } | false | 'error'> {
  try {
    const customer = await callPolarWithRetry(
      () => client.customers.getExternal(companyId),
      `customer provisioning: customers.getExternal for company ${companyId}`,
    );
    return { id: customer.id, type: customer.type };
  } catch (error) {
    if (isResourceNotFoundError(error)) return false;
    logger.warn(
      `Polar customer existence check failed during provisioning (${formatErrorForLog(error)}), ` +
        'retried next pass',
      {
        category: 'billing',
        companyId,
        details: { companyId, ...extractPolarErrorDetails(error) },
      },
    );
    return 'error';
  }
}

/** Swallows its own failure: a DB hiccup must not turn a successful Polar call into `failed`; the
 *  company is simply picked up again next pass. */
async function persistPolarCustomerId(companyId: string, polarCustomerId: string): Promise<void> {
  try {
    await recordPolarCustomerId(companyId, polarCustomerId);
    // A cached "no customer yet" must not outlive this write.
    invalidateCompanyCustomerFactsCache(companyId);
  } catch (error) {
    logger.warn(
      `Failed to persist a confirmed Polar customer id (${formatErrorForLog(error)}), retried next pass`,
      {
        category: 'billing',
        companyId,
        details: { companyId, ...extractPolarErrorDetails(error) },
      },
    );
  }
}

export async function reconcileMissingCompanyCustomers(
  client: BillingCustomerClient = getPolarClient() as unknown as BillingCustomerClient,
): Promise<ReconcileMissingCompanyCustomersSummary> {
  const summary: ReconcileMissingCompanyCustomersSummary = {
    total: 0,
    alreadyExisted: 0,
    created: 0,
    emailTaken: 0,
    skipped: 0,
    failed: 0,
  };

  // `subscription: null` matches companies that have no `CompanySubscription` row yet.
  const where: Prisma.CompanyWhereInput = {
    OR: [{ subscription: null }, { subscription: { polarCustomerId: null } }],
  };

  let cursor: string | undefined;
  for (;;) {
    const companies = await prisma.company.findMany({
      where,
      select: { id: true, name: true, email: true, billingEmail: true },
      orderBy: { id: 'asc' },
      take: CUSTOMER_PROVISIONING_BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (companies.length === 0) break;
    summary.total += companies.length;

    for (const company of companies) {
      const existing = await checkCustomerExists(company.id, client);
      if (existing === 'error') {
        summary.failed++;
        continue;
      }
      if (existing) {
        summary.alreadyExisted++;
        // E.g. created at checkout before this pass saw the company.
        await persistPolarCustomerId(company.id, existing.id);
        // Already promoted to `team` by a checkout between passes. The cast holds at runtime: `client` is
        // the real SDK object, which also satisfies `MemberResolutionClient`.
        if (existing.type === 'team') {
          await ensureCompanyBillingMember(
            company.id,
            existing.id,
            client as unknown as MemberResolutionClient,
          );
        }
        continue;
      }

      // Polar refuses a customer with no email, so do not attempt it.
      if (!resolveBillingEmail(company)) {
        summary.skipped++;
        logger.warn(
          'Polar customer provisioning skipped: company has no billing email (Company.email and ' +
            'Company.billingEmail are both empty), Polar refuses a customer with no email. Set one in ' +
            'Settings > Billing (or Company.email) and it will be picked up on the next pass.',
          {
            category: 'billing',
            companyId: company.id,
            details: { companyId: company.id, companyName: company.name },
          },
        );
        continue;
      }

      try {
        // Re-checks existence once more; accepted to reuse its duplicate-email handling.
        const customer = await callPolarWithRetry(
          () => getOrCreatePolarCustomerForCompany(company, client),
          `customer provisioning: create Polar customer for company ${company.id}`,
        );
        summary.created++;
        await persistPolarCustomerId(company.id, customer.id);
      } catch (error) {
        if (error instanceof BillingEmailTakenError) {
          summary.emailTaken++;
          logger.warn(
            'Polar customer provisioning refused: billing email already used by another Polar customer. ' +
              'Company left without a Polar customer, set a distinct Company.billingEmail ' +
              '(Settings > Billing) and it will be picked up on the next pass.',
            {
              category: 'billing',
              companyId: company.id,
              details: { companyId: company.id, email: error.email },
            },
          );
          continue;
        }
        summary.failed++;
        logger.warn(
          `Polar customer provisioning failed for one company (${formatErrorForLog(error)}), retried ` +
            'next pass',
          {
            category: 'billing',
            companyId: company.id,
            details: { companyId: company.id, ...extractPolarErrorDetails(error) },
          },
        );
      }
    }

    if (companies.length < CUSTOMER_PROVISIONING_BATCH_SIZE) break;
    cursor = companies[companies.length - 1].id;
  }

  return summary;
}
