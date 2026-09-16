/**
 * Opportunistic seat-count reconciliation (product decision 2026-09-16's multi-user follow-up —
 * "un mec paie un siège et invite dix personnes"): `seat-sync.ts` pushes the DB's own seat count to
 * Polar synchronously on every membership change, but that push is BEST-EFFORT (never throws into its
 * caller, see that file's own header). If Polar is unreachable at the exact moment a member is
 * added/removed and NOTHING else changes membership afterward, the two counts silently diverge
 * forever — `seat-sync.ts`'s own header used to describe the periodic lifecycle sweep as a retry that
 * "could also" reconcile seats; this module is that retry, made real.
 *
 * `billing-lifecycle-sweep-runner.ts` calls `reconcileCompanySeats` once per tick for every ACTIVE,
 * subscribed company, comparing the DB's own seat count (`countCompanySeats` — one `UserCompany` row
 * per seat, the source of truth) against what Polar's subscription actually has on file
 * (`subscriptions.get`), and re-pushing the correction (`subscriptions.update`, the same call
 * `seat-sync.ts` makes) when they differ. Idempotent (a no-op once the counts already match) — the
 * caller decides whether a single company's failure here should sink the rest of the sweep pass (it
 * does not: `billing-lifecycle-sweep-runner.ts`'s own per-subscription try/catch already isolates one
 * company from the next), this function itself is free to throw on any Polar/DB failure.
 */
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

import { CompanySubscription } from '../../../prisma/generated/prisma/client';
import { getPolarClient } from './polar-client';
import { countCompanySeats } from './seat-sync';

/** Narrow, mockable subset of the `Polar` SDK client this module calls — same convention every other
 *  billing file narrows its own client shape to. */
export interface SeatReconcileClient {
  subscriptions: {
    get(request: { id: string }): Promise<{ seats?: number | null }>;
    update(request: { id: string; subscriptionUpdate: { seats: number } }): Promise<unknown>;
  };
}

export interface SeatReconcileResult {
  /** `true` when a correction was actually pushed to Polar (the counts had drifted). */
  corrected: boolean;
  localSeats: number;
  polarSeats: number | null;
}

/**
 * Reconciles ONE company's seat count. Returns `null` — never even reads `countCompanySeats` — for a
 * subscription with no `polarSubscriptionId` yet (nothing to compare against, `seat-sync.ts`'s own
 * "nothing to push to Polar yet" guard). Callers decide WHICH subscriptions are worth reconciling
 * (`billing-lifecycle-sweep-runner.ts` only calls this for `ACTIVE` ones) — this function itself has
 * no opinion on subscription status.
 */
export async function reconcileCompanySeats(
  sub: Pick<CompanySubscription, 'companyId' | 'polarSubscriptionId'>,
  client: SeatReconcileClient = getPolarClient() as unknown as SeatReconcileClient,
): Promise<SeatReconcileResult | null> {
  if (!sub.polarSubscriptionId) return null;

  const [localSeats, polarSubscription] = await Promise.all([
    countCompanySeats(sub.companyId),
    client.subscriptions.get({ id: sub.polarSubscriptionId }),
  ]);
  const polarSeats = polarSubscription.seats ?? null;

  if (polarSeats === localSeats) {
    return { corrected: false, localSeats, polarSeats };
  }

  await client.subscriptions.update({
    id: sub.polarSubscriptionId,
    subscriptionUpdate: { seats: localSeats },
  });
  await prisma.companySubscription.update({
    where: { companyId: sub.companyId },
    data: { seats: localSeats },
  });

  logger.warn('Seat drift corrected against Polar', {
    category: 'billing',
    details: { companyId: sub.companyId, polarSeats, localSeats },
  });

  return { corrected: true, localSeats, polarSeats };
}
