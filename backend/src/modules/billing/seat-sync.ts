/**
 * One seat == one `UserCompany` row for a company (the OWNER counts from company creation; an
 * invitation counts only once ACCEPTED — never while merely pending, matching the product brief
 * exactly). Called as a plain, best-effort function from the FOUR places a `UserCompany` row actually
 * changes in this codebase — never through Nest DI, the same "framework-agnostic, called directly"
 * shape `mail/mail.service.ts#sendForCompany` or `documents/stock/apply-stock-on-issuance.ts` already
 * use — so wiring it in never requires touching a constructor (and risking every existing hand-built
 * `new XService(...)` spec for those files):
 *  - `company.service.ts` — a brand-new company's own OWNER row (createCompany);
 *  - `invitations.service.ts` — an EXISTING user accepting an invitation (acceptInvitation);
 *  - `lib/auth.ts` — a BRAND-NEW user signing up via an invitation code or their company's own SSO
 *    (`markInvitationAsUsed`/`attachSsoProvisionedMembership`), the one call site outside Nest DI
 *    entirely;
 *  - `companies.service.ts` — a member being removed (removeMember);
 *  - `auth-extended/account-lifecycle.ts` — a user deleting their OWN account
 *    (`cleanupAfterUserDelete`), once per company the DB's own `ON DELETE CASCADE` already removed
 *    their `UserCompany` row from.
 *
 * A no-op when billing is disabled (checked first, same as every other billing entry point) — so
 * these call sites cost a self-hosted instance nothing beyond one synchronous env read.
 *
 * NEVER throws into its caller: a Polar outage or a bad access token must not turn "accept an
 * invitation" or "remove a member" into a 500 — errors are logged and swallowed, the same
 * "never blocks the write it rides along with" discipline `applyStockOnIssuance`'s own header states
 * for stock effects. The NEXT membership change is one natural retry; `seat-reconcile.ts` is the
 * OTHER one — `billing-lifecycle-sweep-runner.ts` calls it every tick for every ACTIVE, subscribed
 * company, comparing this module's own `countCompanySeats` against what Polar's subscription actually
 * has on file and re-pushing the correction when a failed push here was never retried by a later
 * membership change (the "one person pays for a seat, then invites ten more, but the very last push
 * happened to fail" case).
 *
 * ## Concurrent membership changes for the SAME company
 *
 * Two membership changes landing at (almost) the same instant — two admins removing two different
 * members, an SSO burst provisioning ten users at once — must never (a) push Polar a STALE count
 * because a slower request's read happened to land after a faster request's write, or (b) fire one
 * Polar call PER membership change when only the FINAL count matters. Both are solved by the same
 * mechanism, deliberately unified rather than two separate fixes:
 *
 *  - **In-process coalescing** (`inFlightByCompanyId`/`dirtyCompanyIds` below): a call for a company
 *    that already has a push IN FLIGHT never starts a second, overlapping one — it just marks that
 *    company "dirty" and waits on the SAME in-flight promise. The in-flight run, once it finishes,
 *    checks the dirty flag and — if set — runs exactly ONE more full sync (never one per extra call
 *    that arrived meanwhile). N membership changes arriving within one push's own duration collapse
 *    into at most two real syncs, never N.
 *  - **A `SELECT … FOR UPDATE` row lock** on the company's own `company_subscription` row, held for
 *    the ENTIRE read-count-then-push sequence (chosen over a BullMQ per-company job — the brief's
 *    other offered option — because seat sync already runs synchronously, inline with the request
 *    that changed membership, and adding a queue hop here would turn "invite a member" into an
 *    eventually-consistent operation for no benefit; the row this feature already owns is enough of a
 *    mutex). This is what actually matters ACROSS PROCESSES (the in-process map above only protects a
 *    single replica) and is also what makes the count genuinely "read at send time": the count is
 *    re-read from the database only AFTER the lock is acquired, so whichever transaction is the LAST
 *    to actually commit is always the one holding the true, current count — never an earlier read that
 *    a slower transaction's later write raced past.
 */
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

import { isBillingEnabled } from './billing-flag';
import { getOrCreateCompanySubscription } from './company-subscription.store';
import { callPolarWithRetry, getPolarClient } from './polar-client';

export async function countCompanySeats(companyId: string): Promise<number> {
  return prisma.userCompany.count({ where: { companyId } });
}

/** Companies with a seat push currently running — see this file's own header. */
const inFlightByCompanyId = new Map<string, Promise<void>>();
/** Companies whose membership changed again WHILE their push was in flight — checked, and cleared,
 *  once that push finishes. */
const dirtyCompanyIds = new Set<string>();

/** Test-only: drops both maps so one spec's leftover in-flight state never bleeds into the next. */
export function resetSeatSyncCoalescingForTests(): void {
  inFlightByCompanyId.clear();
  dirtyCompanyIds.clear();
}

export async function syncCompanySeatsOnMembershipChange(companyId: string): Promise<void> {
  if (!isBillingEnabled()) return;

  const inFlight = inFlightByCompanyId.get(companyId);
  if (inFlight) {
    dirtyCompanyIds.add(companyId);
    return inFlight;
  }

  const run = performSeatSync(companyId).finally(() => {
    inFlightByCompanyId.delete(companyId);
  });
  inFlightByCompanyId.set(companyId, run);
  await run;

  // One more membership change landed while `run` was in flight — replay exactly once (never once
  // per change that arrived during the window), picking up whatever the count is NOW.
  if (dirtyCompanyIds.delete(companyId)) {
    await syncCompanySeatsOnMembershipChange(companyId);
  }
}

/** Detects Polar's own `PaymentError`/`PaymentFailed` refusals (`@polar-sh/sdk`'s
 *  `node_modules/@polar-sh/sdk/dist/commonjs/models/errors/paymenterror.d.ts`/`paymentfailed.d.ts`,
 *  read directly — both carry a literal
 *  `error: "PaymentError" | "PaymentFailed"` discriminant) — the shape an immediate-proration seat
 *  INCREASE gets back when the card on file is declined, distinguished here from every OTHER reason
 *  `subscriptions.update` can fail (network outage, an expired access token…), which are logged and
 *  retried the same way they always were, never recorded as a payment failure. Checked structurally,
 *  never importing the SDK's own error classes by name — the same convention
 *  `billing-customer.ts#isEmailAlreadyExistsError` already holds. */
function isPolarPaymentFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { error?: unknown };
  return candidate.error === 'PaymentError' || candidate.error === 'PaymentFailed';
}

async function performSeatSync(companyId: string): Promise<void> {
  try {
    // Ensures the row exists to lock — a brand-new company's very first sync (see this file's own
    // header) has no row yet, and `getOrCreateCompanySubscription`'s own upsert already handles two
    // concurrent FIRST-touches safely on its own.
    await getOrCreateCompanySubscription(companyId);

    await prisma.$transaction(
      async (tx) => {
        // Row lock, held through the push below — see this file's own header on why.
        await tx.$queryRaw`SELECT id FROM company_subscription WHERE "companyId" = ${companyId} FOR UPDATE`;

        const [sub, seats] = await Promise.all([
          tx.companySubscription.findUniqueOrThrow({ where: { companyId } }),
          tx.userCompany.count({ where: { companyId } }),
        ]);

        if (sub.seats !== seats) {
          await tx.companySubscription.update({ where: { companyId }, data: { seats } });
        }

        // Nothing to push to Polar yet — no checkout has ever completed for this company (see
        // `lifecycle.ts`'s own header on why `polarSubscriptionId` is exactly this signal).
        if (!sub.polarSubscriptionId) return;

        try {
          // `SubscriptionUpdateSeats` — the plain, quantity-only half of Polar's `PATCH
          // subscriptions/{id}` (`@polar-sh/sdk`'s `Subscriptions.update`), confirmed by reading
          // `node_modules/@polar-sh/sdk/dist/commonjs/models/components/subscriptionupdateseats.d.ts`
          // directly — NOT the full named-seat claim/assign/revoke subsystem Polar also exposes
          // (`customerSeats`/`customerPortalSeats`), which is a per-named-person invitation UX this
          // task does not build; this only keeps the BILLED COUNT in sync.
          // Through `callPolarWithRetry` — the one choke point every automatic (never user-initiated)
          // Polar sync call shares (`polar-client.ts`'s own header) — bounded exponential retry on a
          // 429, everything else left to this function's own existing swallow-and-log.
          await callPolarWithRetry(
            () =>
              getPolarClient().subscriptions.update({
                id: sub.polarSubscriptionId!,
                subscriptionUpdate: {
                  seats,
                  // Decision: a seat count going DOWN (a member removed/demoted) prorates at the NEXT
                  // billing period — never an immediate credit. Going UP is left at the organization's
                  // own default proration behavior (normally an immediate invoice), so a company that
                  // just added a paying seat is billed for it right away rather than getting it for
                  // free until the next cycle. `subscriptionprorationbehavior.d.ts` (`@polar-sh/sdk`)
                  // confirms `'next_period'` is the exact literal Polar expects.
                  ...(seats < sub.seats ? { prorationBehavior: 'next_period' as const } : {}),
                },
              }),
            `subscriptions.update(seats) for company ${companyId}`,
          );

          // A prior seat-payment failure is now moot — clears the reason `billing-status-view.ts`
          // shows on the Billing page (also cleared, redundantly but harmlessly, the moment the whole
          // SUBSCRIPTION next reports ACTIVE — `webhook-handlers.ts`'s own reset).
          if (sub.seatPaymentFailedAt) {
            await tx.companySubscription.update({
              where: { companyId },
              data: { seatPaymentFailedAt: null },
            });
          }
        } catch (error) {
          if (seats > sub.seats && isPolarPaymentFailure(error)) {
            // A recognized, seat-specific refusal — recorded rather than merely logged, so the OWNER
            // sees WHY the company went PAST_DUE instead of a generic "payment failed" (see
            // `billing-status-view.ts`). Deliberately does NOT rethrow: the local seat count above
            // already reflects reality regardless of whether Polar could bill for it this instant,
            // and this is a KNOWN, actionable state (the OWNER needs to fix their card), not an
            // outage worth the generic warning below.
            await tx.companySubscription.update({
              where: { companyId },
              data: { seatPaymentFailedAt: new Date() },
            });
            logger.warn('Seat increase payment failed — recorded for Settings > Billing to explain', {
              category: 'billing',
              details: { companyId, seats },
            });
            return;
          }
          // Every OTHER failure (outage, bad token…) — logged and swallowed HERE, deliberately inside
          // the transaction, so it never rolls back the local seat count write above: that count is
          // this app's own source of truth regardless of whether Polar could be reached this instant.
          logger.warn('Polar seat sync failed — will retry on the next membership change', {
            category: 'billing',
            details: { companyId, error: error instanceof Error ? error.message : String(error) },
          });
        }
      },
      // Generous timeout: this transaction holds its lock through a real network call to Polar, not
      // just DB work — Prisma's 5s interactive-transaction default is comfortably enough for a normal
      // Polar round-trip, but not with room for a slow one queued behind a burst of coalesced calls.
      { timeout: 15_000 },
    );
  } catch (error) {
    // Reachable only for a failure OUTSIDE the Polar push itself (acquiring the row lock,
    // `getOrCreateCompanySubscription`, the local read/write) — the push's own failure is already
    // logged and swallowed above.
    logger.warn('Polar seat sync failed — will retry on the next membership change', {
      category: 'billing',
      details: { companyId, error: error instanceof Error ? error.message : String(error) },
    });
  }
}
