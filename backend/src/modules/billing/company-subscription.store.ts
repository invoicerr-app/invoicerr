/**
 * The one place `CompanySubscription` rows are read/written from Prisma — every other billing file
 * (`send-gate.ts`, `seat-sync.ts`, `billing-lifecycle-sweep-runner.ts`, `billing.controller.ts`,
 * `webhook-handlers.ts`) goes through this module rather than calling `prisma.companySubscription`
 * itself, the same "one narrow persistence seam" discipline `documents/persistence.ts` holds for the
 * documents module.
 */
import prisma from '@/prisma/prisma.service';

import { CompanySubscription, Prisma } from '../../../prisma/generated/prisma/client';
import { computeRecoveredStatus, computeTrialWindow } from './lifecycle';

/**
 * Returns this company's subscription row, creating it LAZILY (status TRIAL, a fresh 14-day window
 * starting `now`) the first time anything asks. This is what makes "no retroactive enrolment" true:
 * an existing company that predates the billing flag simply has no row until the first time it is
 * actually needed (a send attempt, a `GET /api/billing/status`, a membership change) — at which point
 * its trial is deemed to start THEN, never backdated to when the flag first flipped or to the
 * company's own `createdAt`.
 *
 * `upsert`, not `findUnique` then `create`: two concurrent first-touches (e.g. two tabs both hitting
 * `GET /api/billing/status` for a brand-new company) must not race into a duplicate-key error against
 * the `companyId` unique constraint — the loser's `create` clause simply never applies, and it reads
 * back whatever the winner wrote (`update: {}`, a genuine no-op) instead.
 */
export async function getOrCreateCompanySubscription(
  companyId: string,
  now: Date = new Date(),
): Promise<CompanySubscription> {
  const existing = await prisma.companySubscription.findUnique({ where: { companyId } });
  if (existing) return existing;

  const { trialStartedAt, trialEndsAt } = computeTrialWindow(now);
  return prisma.companySubscription.upsert({
    where: { companyId },
    create: { companyId, trialStartedAt, trialEndsAt },
    update: {},
  });
}

/**
 * Persists `lifecycle.ts#computeRecoveredStatus`'s own decision — the ONE writer for the "this
 * company's Polar subscription facts are gone" repair, shared by `status-reconcile.ts` (a
 * company-scoped customer with no active/trialing subscription) and `webhook-handlers.ts` (a legacy
 * per-user cancellation recovered by `polarSubscriptionId` — see each caller's own header).
 *
 * Clears `interval` (the vanished subscription's own cadence — nothing real left to describe) and
 * `seatPaymentFailedAt` (a seat-specific reason tied to a subscription that no longer exists), the same
 * "fields that stop applying get cleared on the status write that invalidates them" discipline
 * `webhook-handlers.ts#applySubscriptionWebhook` already holds for its own ACTIVE branch. Never clears
 * `polarSubscriptionId` — `lifecycle.ts`'s own header on why that field must stay permanent (the
 * never-paid/paid-then-stopped zip-grace discriminator) or `seats` — the last KNOWN bought quantity
 * (`seat-sync.ts`'s own header: this app only ever reads it from Polar, never derives it locally),
 * never something a subscription's own disappearance makes stale.
 *
 * Stamps `lastPolarFactAt = anchor` too — belt-and-braces alongside the explicit `seatPaymentFailedAt`
 * clear above: `billing-status-view.ts`'s own `seatPaymentFailureExplainsStatus` staleness check is
 * already keyed on this field, so any FUTURE seat-failure fact is correctly compared against this
 * repair's own timestamp rather than a stale one from before the subscription vanished.
 */
export async function recomputeStatusForVanishedSubscription(
  companyId: string,
  trialEndsAt: Date,
  anchor: Date,
  now: Date = new Date(),
): Promise<CompanySubscription> {
  const recovered = computeRecoveredStatus(trialEndsAt, anchor, now);
  return prisma.companySubscription.update({
    where: { companyId },
    data: {
      status: recovered.status,
      blockedAt: recovered.blockedAt,
      interval: null,
      seatPaymentFailedAt: null,
      lastPolarFactAt: anchor,
    },
  });
}

/**
 * Atomically reserves the "a checkout is in flight for this company" window with a single conditional
 * `updateMany` — never a read (`findUnique`) followed by a separate `update`, which leaves a gap where
 * two concurrent requests (a double-click, two tabs, a client retry) both read "nothing in flight" and
 * both go on to open a competing Polar checkout session. `checkout-session.ts` used to have exactly
 * that gap: it read `lastCheckoutStartedAt` before ever calling Polar and only wrote it back after a
 * checkout succeeded — check-then-act, not atomic. Postgres serializes the two `UPDATE`s against the
 * same row: whichever commits first makes the `WHERE` clause false for the other (its `count` comes
 * back `0`), so at most one caller ever proceeds to actually call Polar. Returns the timestamp it
 * stamped on success, `null` when the window was already held by someone else.
 */
export async function reserveCheckoutWindow(
  companyId: string,
  windowMs: number,
  now: Date = new Date(),
): Promise<Date | null> {
  const cutoff = new Date(now.getTime() - windowMs);
  const { count } = await prisma.companySubscription.updateMany({
    where: {
      companyId,
      OR: [{ lastCheckoutStartedAt: null }, { lastCheckoutStartedAt: { lt: cutoff } }],
    },
    data: { lastCheckoutStartedAt: now },
  });
  return count > 0 ? now : null;
}

/**
 * Releases a reservation this exact call made — matched by the timestamp `reserveCheckoutWindow`
 * stamped, so a stale caller (an old attempt that is only now unwinding) can never clobber a fresh
 * reservation someone else has since taken. Used when the Polar call the reservation was guarding never
 * actually produced a checkout (a network failure, a non-tax-id 422…), so the genuine next attempt is
 * not stuck behind the full `CHECKOUT_IN_PROGRESS_WINDOW_MS` for a checkout that was never opened.
 */
export async function releaseCheckoutWindow(companyId: string, reservedAt: Date): Promise<void> {
  await prisma.companySubscription.updateMany({
    where: { companyId, lastCheckoutStartedAt: reservedAt },
    data: { lastCheckoutStartedAt: null },
  });
}

/**
 * Records the Polar customer id `customer-provisioning.ts` just confirmed or created for this company —
 * the ONE write that makes that reconciliation pass idempotent across TICKS, not just within one: once
 * this lands, the company's own `polarCustomerId` is no longer `null`, so the WHERE filter that pass
 * queries with never selects this company again, and this app stops re-checking a Polar customer that
 * was already known to exist. `getOrCreateCompanySubscription` first because a company can be
 * provisioned a Polar customer before it has ever needed a `CompanySubscription` row of its own (its
 * very first boot/sweep pass after signup, still TRIAL, no row yet) — a bare `update` would throw on
 * that company instead of creating the row it needs to hold this fact.
 */
export async function recordPolarCustomerId(companyId: string, polarCustomerId: string): Promise<void> {
  await getOrCreateCompanySubscription(companyId);
  await prisma.companySubscription.update({ where: { companyId }, data: { polarCustomerId } });
}

/**
 * Takes a `SELECT … FOR UPDATE` row lock on this company's own `company_subscription` row, held for
 * the rest of `tx`'s own transaction — the ONE place this exact lock is issued, shared by every seat
 * bookkeeping operation that must not race another one for the SAME company:
 * `seat-sync.ts#withSeatReservation` (a new membership's capacity check + desk assignment),
 * `seats-view.ts#ensureSeatIndexesAssigned` (backfilling a stale/missing desk number) and
 * `seats-view.ts#moveMemberSeat` (an OWNER/ADMIN dragging a member onto a specific desk). None of these
 * callers necessarily need to CHANGE this row itself — they lock it purely to serialize against each
 * other, because `company_subscription` is the one row per company every seat-related decision is
 * already scoped by, so it doubles as this lock's own natural key. The caller is responsible for making
 * sure the row exists first (`getOrCreateCompanySubscription`) — a `SELECT … FOR UPDATE` against a
 * nonexistent row locks nothing and returns no error, which would silently defeat the whole point.
 */
export async function lockCompanySubscriptionRow(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM company_subscription WHERE "companyId" = ${companyId} FOR UPDATE`;
}

/** Every subscription NOT already terminal (`DELETED`) — what the lifecycle sweep walks each tick.
 *  `DELETED` is excluded even though `deletion.ts`'s own header notes no row should ever actually be
 *  read back in that state (deleting `Company` cascades the row away) — kept as a defensive filter
 *  rather than trusting that invariant blindly. */
export async function listAdvanceableCompanySubscriptions(): Promise<CompanySubscription[]> {
  return prisma.companySubscription.findMany({ where: { status: { not: 'DELETED' } } });
}
