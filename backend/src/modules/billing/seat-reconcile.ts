/**
 * This module used to PUSH the local `UserCompany` headcount to Polar as a correction whenever it
 * drifted from what Polar had on file (`seat-sync.ts`'s own header). It now does the exact opposite —
 * it is the periodic half of "Invoicerr only ever READS the seat quantity from Polar": once per
 * lifecycle-sweep tick, for every `ACTIVE`, subscribed company
 * (`billing-lifecycle-sweep-runner.ts`), it re-reads Polar's own subscription and OVERWRITES the local
 * `CompanySubscription.seats` with whatever Polar reports — the retry for the rare case a
 * `subscription.*` webhook carrying a `seats` change was never delivered (or was dropped — see
 * `webhook-handlers.ts`) and nothing else has since re-synced it.
 *
 * Never calls `subscriptions.update` — that would be the exact write this product explicitly rejected;
 * `no-seat-quantity-write.spec.ts` is a standing, file-content guard against it regressing here or in
 * `seat-sync.ts`. Idempotent (a no-op once the counts already match) — the caller decides whether a
 * single company's failure here should sink the rest of the sweep pass (it does not:
 * `billing-lifecycle-sweep-runner.ts`'s own per-subscription try/catch already isolates one company
 * from the next); this function itself is free to throw on any Polar/DB failure.
 */
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

import { CompanySubscription } from '../../../prisma/generated/prisma/client';
import { getPolarClient } from './polar-client';

/** Narrow, mockable subset of the `Polar` SDK client this module calls — same convention every other
 *  billing file narrows its own client shape to. Read-only: no `update` here any more. */
export interface SeatReconcileClient {
  subscriptions: {
    get(request: { id: string }): Promise<{ seats?: number | null }>;
  };
}

export interface SeatReconcileResult {
  /** `true` when the LOCAL row was actually rewritten to match Polar (the two had drifted). */
  corrected: boolean;
  localSeats: number;
  polarSeats: number | null;
}

/**
 * Reconciles ONE company's seat quantity FROM Polar. Returns `null` — never even calls Polar — for a
 * subscription with no `polarSubscriptionId` yet (nothing to read; TRIAL keeps whatever `seats`
 * already holds, which is the schema default of 1 — see `schema.prisma`'s own comment on that column).
 * Callers decide WHICH subscriptions are worth reconciling (`billing-lifecycle-sweep-runner.ts` only
 * calls this for `ACTIVE` ones) — this function itself has no opinion on subscription status.
 *
 * A `null`/`undefined` `seats` on Polar's own response (should not happen for a real seat-based
 * subscription, but the SDK types it as optional) is treated the same as "nothing to compare against":
 * left uncorrected rather than ever writing `null`/`0` over a real local value.
 */
export async function reconcileCompanySeats(
  sub: Pick<CompanySubscription, 'companyId' | 'polarSubscriptionId' | 'seats'>,
  client: SeatReconcileClient = getPolarClient() as unknown as SeatReconcileClient,
): Promise<SeatReconcileResult | null> {
  if (!sub.polarSubscriptionId) return null;

  const polarSubscription = await client.subscriptions.get({ id: sub.polarSubscriptionId });
  const polarSeats = polarSubscription.seats ?? null;

  if (polarSeats === null || polarSeats === sub.seats) {
    return { corrected: false, localSeats: sub.seats, polarSeats };
  }

  await prisma.companySubscription.update({
    where: { companyId: sub.companyId },
    data: { seats: polarSeats },
  });

  logger.warn('Seat quantity drift corrected FROM Polar (local row was stale)', {
    category: 'billing',
    details: { companyId: sub.companyId, previousLocalSeats: sub.seats, polarSeats },
  });

  return { corrected: true, localSeats: polarSeats, polarSeats };
}
