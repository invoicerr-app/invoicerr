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
 *
 * QUERY SCOPE (fixed 2026-09-17 — was a standing incident, not a one-off): this used to load and
 * re-check EVERY `Company` row on every single pass, forever — a company successfully provisioned
 * months ago cost exactly one `customers.getExternal` round-trip per company per tick (default: every
 * hour), indefinitely, because nothing about that success was ever written back to this app's own
 * database. The query below is narrowed to companies whose `CompanySubscription.polarCustomerId` is
 * still `null` (or that have no subscription row at all yet), and `persistPolarCustomerId` writes that
 * id the moment a customer is confirmed to exist OR is created — so a company drops out of this query
 * for good the first time it is successfully resolved, and only a company genuinely still missing one
 * (no billing email, a duplicate-email refusal, a still-unresolved outage) keeps showing up. Paginated
 * (`CUSTOMER_PROVISIONING_BATCH_SIZE`) rather than one unbounded `findMany`, so a fresh instance with a
 * large backlog of never-provisioned companies does not load them all into memory in one round-trip.
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

/** How many companies one `findMany` round-trip loads — the WHERE filter below already narrows the set
 *  to companies still missing a Polar customer, but that set alone can still be large (a fresh instance
 *  importing many companies at once, or a long-standing outage that left a backlog). Small enough to
 *  keep one round-trip's memory footprint bounded; large enough that a normal instance's backlog clears
 *  in a single round-trip almost always. */
export const CUSTOMER_PROVISIONING_BATCH_SIZE = 500;

export interface ReconcileMissingCompanyCustomersSummary {
  total: number;
  /** Already had a company-scoped Polar customer — nothing to do. */
  alreadyExisted: number;
  /** Created a fresh company-scoped Polar customer this pass. */
  created: number;
  /** Refused by Polar (422, duplicate billing email) — left without a customer on purpose; see this
   *  file's own header. Logged by name, `Company.billingEmail` is the fix. */
  emailTaken: number;
  /** Neither `Company.billingEmail` nor `Company.email` resolves to anything (`resolveBillingEmail`
   *  returns an empty string) — Polar always refuses a customer with no email, so this is never even
   *  attempted as a create call. Distinct from `failed`: this is not a transient Polar problem, it is a
   *  data problem on OUR side (a company created without a contact email — seen on a dev-instance test
   *  company, 2026-09-16), so it gets its own named-by-company WARN instead of the generic "failed"
   *  log an on-call reader can't act on. Naturally self-heals on the NEXT boot/sweep pass once
   *  `Company.email` or `Company.billingEmail` is set — this function re-reads both from the DB every
   *  pass, so there is nothing to persist to know "the email changed since last time". */
  skipped: number;
  /** Any other failure (existence check or creation) — logged, left for the next boot/sweep pass. */
  failed: number;
}

/** Pulls `statusCode`/`message` off a thrown Polar error for logging, without ever assuming the shape
 *  (a network-level throw, e.g., carries no `statusCode` at all) and without touching any header or
 *  credential the error object might also carry — same minimal, structurally-typed read as
 *  `isResourceNotFoundError` in `billing-customer.ts`. */
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
 * Issue #535: `LoggerService.warn`/`.error` (`@/logger/logger.service.ts`) only ever print
 * `[category] message` to the process's own stdout, which is what `kubectl logs` shows. Everything
 * under `details` is written to the `Log` table ONLY, reachable from Settings > Logs but never from a
 * pod's own console output. Every WARN below used to pass `extractPolarErrorDetails(error)`'s result
 * EXCLUSIVELY through `details`, with a static message string carrying no dynamic content at all, so
 * the beta's own pod logs showed "Polar customer provisioning failed for one company, retried next
 * pass" with nothing telling an operator why. Proven live against a local stack (2026-09-29, this
 * issue's own repro): a boot pass against a company with a billing email but a bad Polar token printed
 * exactly that bare line to stdout, while the real cause (`statusCode: 401`, Polar's own
 * "invalid_token" body) sat in the `Log` row's `details` the whole time, one click away in the UI but
 * invisible to anyone reading pod logs directly.
 *
 * This renders the SAME fields `extractPolarErrorDetails` already extracts (`statusCode`/`message`
 * only, never `rawResponse`/`headers`/`data$`, the three fields `polar-client.ts#sanitizePolarError`
 * strips before any error from `getPolarClient()` can reach a catch block at all, see that file's own
 * header for the credential-leak this module never re-introduces) into the visible message string
 * itself, the same "put what the console needs directly in the template literal" convention
 * `polar-client.ts`'s own rate-limit warning already uses. `details` keeps carrying the structured
 * version for the Log table/UI, this is additive, not a replacement.
 *
 * Named generically ("...ErrorForLog", not "...PolarErrorForLog") because `persistPolarCustomerId`'s
 * own catch below reuses it for a plain DB write failure, not a Polar call at all: `statusCode`
 * simply reads `'unknown'` for that case, which is still more useful on a console line than nothing.
 */
function formatErrorForLog(error: unknown): string {
  const { statusCode, message } = extractPolarErrorDetails(error);
  return `status ${statusCode}: ${message}`;
}

/** `false` (never throws) on anything other than "no customer registered at all" — the caller treats
 *  that as `failed`, not as `false` meaning "definitely missing", so a transient outage never causes a
 *  duplicate-creation attempt to race a customer that may already exist. Returns the customer's own id
 *  AND `type` on success so the caller can persist the id (`persistPolarCustomerId`) and, for a `type:
 *  "team"` customer discovered here retroactively (promoted by a real checkout since this app last saw
 *  it), also ensure the company's own billing member (`member-sync.ts#ensureCompanyBillingMember`) —
 *  the id-only return was this file's earlier state; `type` was added for that second use. */
async function checkCustomerExists(
  companyId: string,
  client: BillingCustomerClient,
): Promise<{ id: string; type: string } | false | 'error'> {
  try {
    const customer = await callPolarWithRetry(
      () => client.customers.getExternal({ externalId: companyId }),
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

/** Persists the Polar customer id this pass just confirmed or created — the write that makes a
 *  provisioned company stop showing up in this file's own query on the NEXT pass (see this file's own
 *  header). Swallows its own failure (logged, not thrown, and not counted against the pass's
 *  already-recorded `alreadyExisted`/`created` outcome for this company): a DB hiccup on this write must
 *  not turn an otherwise-successful Polar call into a `failed` company — `polarCustomerId` simply stays
 *  `null`, so the query picks this company up again next pass, the same retry-by-omission every other
 *  unresolved case in this file already relies on. */
async function persistPolarCustomerId(companyId: string, polarCustomerId: string): Promise<void> {
  try {
    await recordPolarCustomerId(companyId, polarCustomerId);
    // This boot/sweep pass just confirmed (or created) this company's Polar customer — the same
    // false→true instant `checkout-session.ts` invalidates for its own caller, see
    // `legacy-customer.ts`'s own header on why a cached "no customer yet" must not outlive this write.
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

/**
 * Walks `Company` rows that do NOT yet have a known Polar customer id, and makes sure each one gets
 * one, creating it where missing. Returns a summary this file's boot service (and the lifecycle sweep)
 * logs — see this file's own header for the exact counts' meaning and for why the query is filtered and
 * paginated rather than an unbounded `findMany` over every company.
 */
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

  // `subscription: null` covers a company that has never had a `CompanySubscription` row created at
  // all (still in its very first TRIAL, never touched by this pass before); the second arm covers one
  // that has a row but no Polar customer id recorded on it yet.
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
        // Retroactively records a customer this app already knew about at Polar but had never written
        // back locally (e.g. created directly at checkout, before this pass ever saw the company) — the
        // fix that makes this company drop out of the query above from now on.
        await persistPolarCustomerId(company.id, existing.id);
        // A customer discovered here can already be `type: "team"` (promoted by a real checkout
        // between passes) — proactively ensure the company's own billing member exists for it too,
        // rather than waiting for the next membership change or portal click to do it lazily. Cast
        // locally: at runtime `client` is always the real `Polar` SDK object (satisfies the wider
        // `MemberResolutionClient` surface too), so only a spec that deliberately drives the `team`
        // branch needs to build a fake `client` that actually carries `members`/`customers.members`.
        if (existing.type === 'team') {
          await ensureCompanyBillingMember(
            company.id,
            existing.id,
            client as unknown as MemberResolutionClient,
          );
        }
        continue;
      }

      // No email anywhere on the company — Polar will refuse the create outright, so don't even attempt
      // it (and don't log it as an opaque "failed"). Re-evaluated fresh from the DB row every pass, so a
      // company only stops showing up here once someone actually sets an email — nothing is persisted to
      // track "did the email change since last tick".
      if (!resolveBillingEmail(company)) {
        summary.skipped++;
        logger.warn(
          'Polar customer provisioning skipped: company has no billing email (Company.email and ' +
            'Company.billingEmail are both empty) — Polar refuses a customer with no email. Set one in ' +
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
        // Re-checks existence internally (one more `getExternal`, now known to 404) before creating —
        // accepted redundancy for a boot-time-or-sweep-tick pass, never a hot path: reusing this already
        // email-taken-aware, already-tested function beats duplicating its 422 handling here.
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
              'Company left without a Polar customer — set a distinct Company.billingEmail ' +
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
